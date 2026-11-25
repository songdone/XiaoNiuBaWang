package nas

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/sys/unix"

	"xiaoniubawang/internal/fnos"
)

var ErrJobNotFound = errors.New("未找到扫描任务")
var ErrBusy = errors.New("已有扫描任务正在运行或扫描数量已满")

const maxScanEntries = 16384

type Job struct {
	ID              string  `json:"id"`
	Path            string  `json:"path"`
	Status          string  `json:"status"`
	Visited         int     `json:"visited"`
	Discovered      int     `json:"discovered"`
	Imported        int     `json:"imported"`
	Skipped         int     `json:"skipped,omitempty"`
	Failed          int     `json:"failed"`
	Errors          []Issue `json:"errors"`
	StartedAt       string  `json:"startedAt"`
	FinishedAt      string  `json:"finishedAt,omitempty"`
	CancelRequested bool    `json:"cancelRequested,omitempty"`
}
type scanJob struct {
	job      Job
	owner    fnos.User
	physical string
	cancel   context.CancelFunc
	done     chan struct{}
}
type Scanner struct {
	service *Service
	mu      sync.Mutex
	jobs    map[string]*scanJob
	closed  bool
}

func NewScanner(service *Service) *Scanner {
	return &Scanner{service: service, jobs: map[string]*scanJob{}}
}
func snapshot(j *scanJob) Job {
	out := j.job
	out.Errors = append([]Issue{}, j.job.Errors...)
	return out
}

func (s *Scanner) Start(ctx context.Context, user fnos.User, key string) (Job, error) {
	p, err := s.service.resolve(user, key)
	if err != nil {
		return Job{}, err
	}
	// Validate both authorization and directory type before scheduling work.
	if _, err := s.service.authorized(ctx, user, p); err != nil {
		return Job{}, err
	}
	r, err := pinDir(p)
	if err != nil {
		return Job{}, err
	}
	r.Close()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return Job{}, ErrUnavailable
	}
	active := 0
	for _, j := range s.jobs {
		select {
		case <-j.done:
		default:
			active++
			if j.owner == user {
				return Job{}, ErrBusy
			}
		}
	}
	if active >= 4 {
		return Job{}, ErrBusy
	}
	if len(s.jobs) >= 128 {
		for id, j := range s.jobs {
			select {
			case <-j.done:
				delete(s.jobs, id)
			default:
			}
			if len(s.jobs) < 128 {
				break
			}
		}
	}
	if len(s.jobs) >= 128 {
		return Job{}, ErrBusy
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return Job{}, ErrUnavailable
	}
	work, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	j := &scanJob{owner: user, physical: p, cancel: cancel, done: make(chan struct{}), job: Job{ID: hex.EncodeToString(id[:]), Path: key, Status: "queued", StartedAt: time.Now().UTC().Format(time.RFC3339Nano), Errors: []Issue{}}}
	s.jobs[j.job.ID] = j
	go s.run(work, j)
	return snapshot(j), nil
}

func (s *Scanner) Get(user fnos.User, id string) (Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j := s.jobs[id]
	if j == nil || j.owner != user {
		return Job{}, ErrJobNotFound
	}
	return snapshot(j), nil
}

func (s *Scanner) Cancel(ctx context.Context, user fnos.User, id string) (Job, error) {
	s.mu.Lock()
	j := s.jobs[id]
	if j == nil || j.owner != user {
		s.mu.Unlock()
		return Job{}, ErrJobNotFound
	}
	select {
	case <-j.done:
		s.mu.Unlock()
		return s.Get(user, id)
	default:
	}
	j.job.CancelRequested = true
	j.cancel()
	done := j.done
	s.mu.Unlock()
	select {
	case <-done:
	case <-ctx.Done():
		return Job{}, ctx.Err()
	}
	return s.Get(user, id)
}

func (s *Scanner) Close() {
	s.mu.Lock()
	s.closed = true
	jobs := make([]*scanJob, 0, len(s.jobs))
	for _, j := range s.jobs {
		j.cancel()
		jobs = append(jobs, j)
	}
	s.mu.Unlock()
	for _, j := range jobs {
		<-j.done
	}
}

func (s *Scanner) update(j *scanJob, f func(*Job)) { s.mu.Lock(); f(&j.job); s.mu.Unlock() }
func (s *Scanner) addError(j *scanJob, p string, err error) {
	s.update(j, func(out *Job) {
		out.Failed++
		if len(out.Errors) < 64 {
			out.Errors = append(out.Errors, issue(p, err))
		}
	})
}

func (s *Scanner) run(ctx context.Context, j *scanJob) {
	defer j.cancel()
	s.update(j, func(out *Job) { out.Status = "running" })
	err := s.walk(ctx, j, j.physical, 0)
	s.mu.Lock()
	switch {
	case errors.Is(ctx.Err(), context.Canceled):
		j.job.Status = "cancelled"
	case ctx.Err() != nil:
		j.job.Status = "failed"
		j.job.Failed++
		if len(j.job.Errors) < 64 {
			j.job.Errors = append(j.job.Errors, Issue{Path: j.job.Path, Code: "scan_timeout", Message: "扫描达到时间上限，未检查全部文件；已导入卡带已保留"})
		}
	case err != nil:
		j.job.Status = "failed"
		j.job.Failed++
		if len(j.job.Errors) < 64 {
			j.job.Errors = append(j.job.Errors, issue(j.job.Path, err))
		}
	default:
		j.job.Status = "completed"
	}
	j.job.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	close(j.done)
	s.mu.Unlock()
}

// Unlike the intentionally capped UI listing, scans hold a pinned directory
// cursor and inspect bounded batches. Unsupported entries count toward the
// global budget too, so large directories cannot silently truncate or bypass it.
func (s *Scanner) walk(ctx context.Context, j *scanJob, p string, depth int) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if depth > 32 {
		return ErrLimit
	}
	if _, err := s.service.authorized(ctx, j.owner, p); err != nil {
		return err
	}
	dir, err := pinDir(p)
	if err != nil {
		return err
	}
	defer dir.Close()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		roots, _, err := s.service.authorizedRoots(ctx, j.owner, p)
		if err != nil {
			return err
		}
		names, err := dir.Readdirnames(128)
		if err != nil && !errors.Is(err, io.EOF) {
			return err
		}
		for _, name := range names {
			if err := ctx.Err(); err != nil {
				return err
			}
			s.mu.Lock()
			if j.job.Visited >= maxScanEntries {
				s.mu.Unlock()
				return ErrLimit
			}
			j.job.Visited++
			s.mu.Unlock()
			full := filepath.Join(p, name)
			if !validPath(full) || filepath.Dir(full) != p {
				continue
			}
			info, statErr := lstatAt(dir, name)
			if statErr != nil {
				s.addError(j, full, statErr)
				continue
			}
			isDir := info.Mode&unix.S_IFMT == unix.S_IFDIR
			if !isDir && (info.Mode&unix.S_IFMT != unix.S_IFREG || info.Nlink != 1 || !isROMExt(name)) {
				continue
			}
			if isDir {
				if err := s.service.authorizedWithin(ctx, j.owner, roots, full); err != nil {
					if ctx.Err() != nil || errors.Is(err, ErrUnavailable) {
						return err
					}
					s.addError(j, full, err)
					continue
				}
				if err := s.walk(ctx, j, full, depth+1); err != nil {
					if ctx.Err() != nil {
						return ctx.Err()
					}
					if errors.Is(err, ErrUnavailable) || errors.Is(err, ErrLimit) {
						return err
					}
					s.addError(j, full, err)
				}
				continue
			}
			s.update(j, func(out *Job) { out.Discovered++ })
			_, created, skipped, err := s.service.importOneInDir(ctx, j.owner, dir, name, full, roots)
			if err != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				if errors.Is(err, ErrUnavailable) {
					return err
				}
				s.addError(j, full, err)
				continue
			}
			s.update(j, func(out *Job) {
				out.Imported += created
				out.Skipped += skipped
			})
		}
		if errors.Is(err, io.EOF) {
			_, err := s.service.authorized(ctx, j.owner, p)
			return err
		}
	}
}
