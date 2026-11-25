package nas

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"xiaoniubawang/internal/fnos"
	"xiaoniubawang/internal/library"
	"xiaoniubawang/internal/store"
)

func realROM(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile("../../emulator/diagnostics/matrix-diagnostic.nes")
	if err != nil || len(b) < 16400 || !bytes.Equal(b[:4], []byte("NES\x1a")) {
		t.Fatalf("real licensed diagnostic ROM fixture: %v", err)
	}
	return b
}

func realLibrary(t *testing.T) *library.Service {
	t.Helper()
	ctx := context.Background()
	data := tempDir(t)
	if err := os.Chmod(data, 0700); err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(ctx, data)
	if err != nil {
		t.Fatal(err)
	}
	lib, err := library.New(ctx, st, "")
	if err != nil {
		st.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close(); st.Close() })
	return lib
}

func waitScan(t *testing.T, scanner *Scanner, id string) Job {
	t.Helper()
	scanner.mu.Lock()
	done := scanner.jobs[id].done
	scanner.mu.Unlock()
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("scan timeout")
	}
	job, err := scanner.Get(testUser, id)
	if err != nil {
		t.Fatal(err)
	}
	return job
}

func TestScannerStreamsBeyondBrowseLimitWithRealROM(t *testing.T) {
	ctx := context.Background()
	root := tempDir(t)
	// These files consume the old UI listing cap, but scans must walk beyond it.
	for i := range MaxEntries + 129 {
		write(t, filepath.Join(root, fmt.Sprintf("ignored-%05d.txt", i)), []byte("not a ROM"))
	}
	rom := realROM(t)
	write(t, filepath.Join(root, "playable.nes"), rom)
	lib := realLibrary(t)
	service := New(&fakeAuth{root: root, user: testUser}, lib)
	roots, err := service.Roots(ctx, testUser)
	if err != nil || len(roots) != 1 {
		t.Fatalf("roots: %+v %v", roots, err)
	}
	listing, err := service.Browse(ctx, testUser, roots[0].Path)
	if err != nil || !listing.Truncated {
		t.Fatalf("expected capped browse: %+v %v", listing, err)
	}
	scanner := NewScanner(service)
	defer scanner.Close()
	for round := range 2 {
		job, err := scanner.Start(ctx, testUser, roots[0].Path)
		if err != nil {
			t.Fatal(err)
		}
		job = waitScan(t, scanner, job.ID)
		wantImported, wantSkipped := 1, 0
		if round == 1 {
			wantImported, wantSkipped = 0, 1
		}
		if job.Status != "completed" || job.Visited != MaxEntries+130 || job.Discovered != 1 || job.Imported != wantImported || job.Skipped != wantSkipped || job.Failed != 0 {
			t.Fatalf("large directory scan round=%d: %+v", round, job)
		}
	}
	games, err := lib.List(ctx, testUser)
	if err != nil || len(games) != 1 {
		t.Fatalf("deduped managed library: %+v %v", games, err)
	}
	_, f, err := lib.Open(ctx, testUser, games[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	managed, err := io.ReadAll(f)
	if err != nil || !bytes.Equal(managed, rom) {
		t.Fatal("managed real ROM differs from source")
	}
}

func TestScannerBudgetCountsUnsupportedEntriesAndNeverClaimsComplete(t *testing.T) {
	root := tempDir(t)
	for i := range maxScanEntries + 1 {
		write(t, filepath.Join(root, fmt.Sprintf("ignored-%05d.txt", i)), nil)
	}
	service := New(&fakeAuth{root: root, user: testUser}, nil)
	key, err := service.handle(testUser, root)
	if err != nil {
		t.Fatal(err)
	}
	scanner := NewScanner(service)
	defer scanner.Close()
	job, err := scanner.Start(context.Background(), testUser, key)
	if err != nil {
		t.Fatal(err)
	}
	job = waitScan(t, scanner, job.ID)
	if job.Status != "failed" || job.Visited != maxScanEntries || job.Discovered != 0 || len(job.Errors) != 1 || job.Errors[0].Code != "limit_exceeded" {
		t.Fatalf("budget bypass or false completion: %+v", job)
	}
}

func TestScannerCancelledAndFailedPrefixRemainsInRealLibrary(t *testing.T) {
	for _, mode := range []string{"cancel", "failure"} {
		t.Run(mode, func(t *testing.T) {
			root := tempDir(t)
			write(t, filepath.Join(root, "one.nes"), realROM(t))
			write(t, filepath.Join(root, "two.nes"), realROM(t))
			lib := realLibrary(t)
			started := make(chan struct{})
			var calls atomic.Int32
			service := New(&fakeAuth{root: root, user: testUser}, importFunc(func(ctx context.Context, user fnos.User, in []library.Upload) ([]store.Game, error) {
				if calls.Add(1) == 1 {
					return lib.Import(ctx, user, in)
				}
				close(started)
				if mode == "failure" {
					return nil, ErrUnavailable
				}
				<-ctx.Done()
				return nil, ctx.Err()
			}))
			key, err := service.handle(testUser, root)
			if err != nil {
				t.Fatal(err)
			}
			scanner := NewScanner(service)
			defer scanner.Close()
			job, err := scanner.Start(context.Background(), testUser, key)
			if err != nil {
				t.Fatal(err)
			}
			select {
			case <-started:
			case <-time.After(5 * time.Second):
				t.Fatal("partial scan did not reach second import")
			}
			if mode == "cancel" {
				job, err = scanner.Cancel(context.Background(), testUser, job.ID)
			} else {
				job = waitScan(t, scanner, job.ID)
			}
			if err != nil || job.Imported != 1 || mode == "cancel" && job.Status != "cancelled" || mode == "failure" && job.Status != "failed" {
				t.Fatalf("terminal prefix: %+v %v", job, err)
			}
			games, err := lib.List(context.Background(), testUser)
			if err != nil || len(games) != 1 {
				t.Fatalf("partial imports were lost: %+v %v", games, err)
			}
		})
	}
}

func TestScannerDeadlineIsFailureNotUserCancellation(t *testing.T) {
	service := New(nil, nil)
	scanner := NewScanner(service)
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	job := &scanJob{job: Job{Path: "nas_test", Errors: []Issue{}}, done: make(chan struct{}), cancel: func() {}}
	scanner.run(ctx, job)
	if job.job.Status != "failed" || len(job.job.Errors) != 1 || job.job.Errors[0].Code != "scan_timeout" {
		t.Fatalf("deadline looks like completed/cancelled scan: %+v", job.job)
	}
	if !errors.Is(ctx.Err(), context.DeadlineExceeded) {
		t.Fatal("test deadline did not elapse")
	}
}
