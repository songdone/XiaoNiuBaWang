package nas

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/sys/unix"
	"xiaoniubawang/internal/fnos"
	"xiaoniubawang/internal/library"
	"xiaoniubawang/internal/store"
)

const testUser fnos.User = "uid-1001"

type fakeAuth struct {
	root  string
	user  fnos.User
	check func(string) bool
	mu    sync.Mutex
}

func (a *fakeAuth) Roots(ctx context.Context, user fnos.User) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if user != a.user {
		return []string{}, nil
	}
	return []string{a.root}, nil
}
func (a *fakeAuth) Readable(ctx context.Context, user fnos.User, p string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return user == a.user && (a.check == nil || a.check(p)), nil
}

type importFunc func(context.Context, fnos.User, []library.Upload) ([]store.Game, error)

func (f importFunc) Import(ctx context.Context, u fnos.User, uploads []library.Upload) ([]store.Game, error) {
	return f(ctx, u, uploads)
}
func tempDir(t *testing.T) string {
	t.Helper()
	p, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func fixtureROM() []byte { b := make([]byte, 16+16384); copy(b, "NES\x1a"); b[4] = 1; return b }
func write(t *testing.T, p string, b []byte) {
	t.Helper()
	if err := os.WriteFile(p, b, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestAuthorizedBrowseAndStrictPaths(t *testing.T) {
	ctx := context.Background()
	root := tempDir(t)
	outside := tempDir(t)
	write(t, filepath.Join(root, "good.nes"), fixtureROM())
	write(t, filepath.Join(root, "ignore.txt"), []byte("text"))
	write(t, filepath.Join(root, "denied.nes"), fixtureROM())
	write(t, filepath.Join(outside, "escape.nes"), fixtureROM())
	if err := os.Mkdir(filepath.Join(root, "sub"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "linked")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("good.nes", filepath.Join(root, "link.nes")); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(filepath.Join(outside, "escape.nes"), filepath.Join(root, "hard.nes")); err != nil {
		t.Fatal(err)
	}
	if err := unix.Mkfifo(filepath.Join(root, "pipe.nes"), 0600); err != nil {
		t.Fatal(err)
	}
	a := &fakeAuth{root: root, user: testUser, check: func(p string) bool { return !strings.HasSuffix(p, "denied.nes") }}
	var imported atomic.Int64
	s := New(a, importFunc(func(ctx context.Context, u fnos.User, in []library.Upload) ([]store.Game, error) {
		_, err := io.ReadAll(in[0].Reader)
		if err != nil {
			return nil, err
		}
		imported.Add(1)
		return []store.Game{{ID: "one"}}, nil
	}))
	roots, err := s.Roots(ctx, testUser)
	if err != nil || len(roots) != 1 {
		t.Fatalf("roots=%+v err=%v", roots, err)
	}
	listing, err := s.Browse(ctx, testUser, roots[0].Path)
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Entries) != 2 || listing.Entries[0].Kind != "directory" || listing.Entries[1].Name != "good.nes" || listing.Parent != nil || listing.SkippedLinks != 4 {
		t.Fatalf("unexpected listing %+v", listing)
	}
	paths := []string{root + "/../" + filepath.Base(outside) + "/escape.nes", root + "\\good.nes", root + "//good.nes", root + "/./good.nes", filepath.Join(root, "linked", "escape.nes"), filepath.Join(root, "link.nes"), filepath.Join(root, "hard.nes"), filepath.Join(root, "pipe.nes"), filepath.Join(root, "denied.nes"), filepath.Join(outside, "escape.nes")}
	for _, p := range paths {
		t.Run(displayPath(p), func(t *testing.T) {
			if _, err := s.openROM(ctx, testUser, p); err == nil {
				t.Fatalf("unsafe physical open accepted %q", p)
			}
			out, err := s.Import(ctx, testUser, []string{p})
			if err != nil || out.Imported != 0 || len(out.Failed) != 1 {
				t.Fatalf("raw path accepted %q: %+v %v", p, out, err)
			}
			data, _ := json.Marshal(out)
			if bytes.Contains(data, []byte(root)) || bytes.Contains(data, []byte(outside)) {
				t.Fatal("physical path leaked in errors")
			}
		})
	}
	if imported.Load() != 0 {
		t.Fatal("unsafe content reached importer")
	}
	if _, err := s.Browse(ctx, "uid-1002", roots[0].Path); !errors.Is(err, ErrRefresh) {
		t.Fatalf("cross-user handle browse err=%v", err)
	}
	if _, err := s.Browse(ctx, testUser, root); !errors.Is(err, ErrPath) {
		t.Fatalf("raw browse accepted %v", err)
	}
	out, err := s.Import(ctx, testUser, []string{listing.Entries[1].Path})
	if err != nil || out.Imported != 1 {
		t.Fatalf("safe import %+v %v", out, err)
	}
	data, _ := json.Marshal(struct {
		Roots   []Root
		Listing Listing
	}{roots, listing})
	if bytes.Contains(data, []byte(root)) || !validHandle(roots[0].Path) || !validHandle(listing.Root) || !validHandle(listing.Entries[0].Path) {
		t.Fatal("directory response exposed physical paths")
	}
}

func TestACLRevokedAfterPinPreventsImport(t *testing.T) {
	root := tempDir(t)
	p := filepath.Join(root, "good.nes")
	write(t, p, fixtureROM())
	checks := 0
	a := &fakeAuth{root: root, user: testUser, check: func(path string) bool {
		if path == p {
			checks++
			return checks == 1
		}
		return true
	}}
	var reads atomic.Int64
	s := New(a, importFunc(func(context.Context, fnos.User, []library.Upload) ([]store.Game, error) {
		reads.Add(1)
		return nil, nil
	}))
	key, err := s.handle(testUser, p)
	if err != nil {
		t.Fatal(err)
	}
	out, err := s.Import(context.Background(), testUser, []string{key})
	if err != nil || out.Imported != 0 || len(out.Failed) != 1 || out.Failed[0].Code != "access_denied" || reads.Load() != 0 {
		t.Fatalf("revoked import %+v %v reads=%d", out, err, reads.Load())
	}
}

func TestSwapDirectoryToSymlinkFailsClosed(t *testing.T) {
	root := tempDir(t)
	outside := tempDir(t)
	sub := filepath.Join(root, "sub")
	if err := os.Mkdir(sub, 0700); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(sub, "good.nes"), fixtureROM())
	write(t, filepath.Join(outside, "good.nes"), []byte("secret"))
	var once sync.Once
	a := &fakeAuth{root: root, user: testUser, check: func(p string) bool {
		if p == filepath.Join(sub, "good.nes") {
			once.Do(func() {
				if err := os.Rename(sub, sub+"-old"); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(outside, sub); err != nil {
					t.Fatal(err)
				}
			})
		}
		return true
	}}
	s := New(a, importFunc(func(context.Context, fnos.User, []library.Upload) ([]store.Game, error) {
		t.Fatal("symlink reached importer")
		return nil, nil
	}))
	key, err := s.handle(testUser, filepath.Join(sub, "good.nes"))
	if err != nil {
		t.Fatal(err)
	}
	out, err := s.Import(context.Background(), testUser, []string{key})
	if err != nil || out.Imported != 0 || len(out.Failed) != 1 {
		t.Fatalf("swap %+v %v", out, err)
	}
}

func TestScannerCancellationAndOwnerIsolation(t *testing.T) {
	root := tempDir(t)
	write(t, filepath.Join(root, "one.nes"), fixtureROM())
	write(t, filepath.Join(root, "two.nes"), fixtureROM())
	started := make(chan struct{})
	finished := make(chan struct{})
	var calls atomic.Int64
	s := New(&fakeAuth{root: root, user: testUser}, importFunc(func(ctx context.Context, u fnos.User, in []library.Upload) ([]store.Game, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-ctx.Done()
		close(finished)
		return nil, ctx.Err()
	}))
	scanner := NewScanner(s)
	defer scanner.Close()
	key, err := s.handle(testUser, root)
	if err != nil {
		t.Fatal(err)
	}
	job, err := scanner.Start(context.Background(), testUser, key)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("scan did not start")
	}
	if _, err = scanner.Get("uid-1002", job.ID); !errors.Is(err, ErrJobNotFound) {
		t.Fatal("cross-user scan visible")
	}
	if _, err = scanner.Cancel(context.Background(), "uid-1002", job.ID); !errors.Is(err, ErrJobNotFound) {
		t.Fatal("cross-user cancellation accepted")
	}
	if _, err = scanner.Start(context.Background(), testUser, key); !errors.Is(err, ErrBusy) {
		t.Fatalf("parallel scan %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	job, err = scanner.Cancel(ctx, testUser, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-finished:
	default:
		t.Fatal("cancel returned before importer stopped")
	}
	if job.Status != "cancelled" || job.Imported != 0 || calls.Load() != 1 || job.FinishedAt == "" {
		t.Fatalf("cancelled job %+v calls=%d", job, calls.Load())
	}
	job, err = scanner.Get(testUser, job.ID)
	if err != nil || job.Status != "cancelled" {
		t.Fatal("terminal status lost")
	}
}

func TestRescanUsesRealLibraryHashDedupe(t *testing.T) {
	ctx := context.Background()
	root := tempDir(t)
	write(t, filepath.Join(root, "one.nes"), fixtureROM())
	write(t, filepath.Join(root, "same.nes"), fixtureROM())
	data := tempDir(t)
	if err := os.Chmod(data, 0700); err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(ctx, data)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	lib, err := library.New(ctx, st, "")
	if err != nil {
		t.Fatal(err)
	}
	defer lib.Close()
	service := New(&fakeAuth{root: root, user: testUser}, lib)
	key, err := service.handle(testUser, root)
	if err != nil {
		t.Fatal(err)
	}
	scanner := NewScanner(service)
	defer scanner.Close()
	for round := range 2 {
		job, err := scanner.Start(ctx, testUser, key)
		if err != nil {
			t.Fatal(err)
		}
		scanner.mu.Lock()
		done := scanner.jobs[job.ID].done
		scanner.mu.Unlock()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("rescan timeout")
		}
		job, err = scanner.Get(testUser, job.ID)
		wantImported, wantSkipped := 1, 1
		if round == 1 {
			wantImported, wantSkipped = 0, 2
		}
		if err != nil || job.Status != "completed" || job.Discovered != 2 || job.Imported != wantImported || job.Skipped != wantSkipped || job.Failed != 0 {
			t.Fatalf("scan round=%d %+v %v", round, job, err)
		}
	}
	games, err := lib.List(ctx, testUser)
	if err != nil || len(games) != 1 {
		t.Fatalf("dedupe games=%+v err=%v", games, err)
	}
	_, f, err := lib.Open(ctx, testUser, games[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	b, err := io.ReadAll(f)
	f.Close()
	if err != nil || !bytes.Equal(b, fixtureROM()) {
		t.Fatal("managed copy differs")
	}
}

func TestOpaqueHandlesExpireAndRecheckAuthorization(t *testing.T) {
	root := tempDir(t)
	write(t, filepath.Join(root, "one.nes"), fixtureROM())
	a := &fakeAuth{root: root, user: testUser}
	s := New(a, importFunc(func(context.Context, fnos.User, []library.Upload) ([]store.Game, error) {
		t.Fatal("denied handle reached importer")
		return nil, nil
	}))
	roots, err := s.Roots(context.Background(), testUser)
	if err != nil || len(roots) != 1 {
		t.Fatal("roots")
	}
	key := roots[0].Path
	if _, err = s.Browse(context.Background(), "uid-1002", key); !errors.Is(err, ErrRefresh) {
		t.Fatal("handle not owner-scoped")
	}
	fresh := New(a, nil)
	if _, err = fresh.Browse(context.Background(), testUser, key); !errors.Is(err, ErrRefresh) {
		t.Fatal("restart accepted lost handle")
	}
	a.mu.Lock()
	a.check = func(string) bool { return false }
	a.mu.Unlock()
	if _, err = s.Browse(context.Background(), testUser, key); !errors.Is(err, ErrDenied) {
		t.Fatalf("revoked ACL err %v", err)
	}
	s.mu.Lock()
	h := s.handles[key]
	h.expires = time.Now().Add(-time.Second)
	s.handles[key] = h
	s.mu.Unlock()
	if _, err = s.Browse(context.Background(), testUser, key); !errors.Is(err, ErrRefresh) {
		t.Fatalf("expired handle err %v", err)
	}
	if _, err = s.Browse(context.Background(), testUser, "/etc"); !errors.Is(err, ErrPath) {
		t.Fatal("raw absolute path accepted")
	}
}

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestOfficialGatewayPayloadAndFailClosed(t *testing.T) {
	var calls atomic.Int64
	g := &Gateway{enabled: true, token: "test-server-only", appName: "xiaoniubawang", client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		if r.URL.Path != "/api/v1/trimapp" || r.Method != "POST" || r.Header.Get("Authorization") != "Bearer test-server-only" {
			t.Fatal("wrong gateway transport")
		}
		var in struct {
			Req     string         `json:"req"`
			AppName string         `json:"appName"`
			Data    map[string]any `json:"data"`
		}
		if json.NewDecoder(r.Body).Decode(&in) != nil || in.AppName != "xiaoniubawang" || in.Data["uid"] != float64(1001) {
			t.Fatal("wrong official uid payload")
		}
		body := `{"code":0,"data":{"paths":["/vol1/roms"]}}`
		if in.Req == "trim.file.checkUserACL" {
			if in.Data["path"] != "/vol1/roms/game.nes" {
				t.Fatal("wrong ACL path")
			}
			body = `{"code":0,"data":[{"path":"/vol1/roms/game.nes","readable":true,"writable":false,"deletable":false}]}`
		} else if in.Req != "trim.file.getUserAccessibleFolders" {
			t.Fatal("invented request")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}}
	roots, err := g.Roots(context.Background(), testUser)
	if err != nil || len(roots) != 1 {
		t.Fatalf("roots %v %v", roots, err)
	}
	ok, err := g.Readable(context.Background(), testUser, "/vol1/roms/game.nes")
	if err != nil || !ok {
		t.Fatalf("acl %v %v", ok, err)
	}
	if _, err = g.Roots(context.Background(), "dev-test"); !errors.Is(err, ErrUnavailable) || calls.Load() != 2 {
		t.Fatal("local identity reached gateway")
	}
	a, err := fnos.NewAuth(fnos.Local, "test")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("TRIM_API_TOKEN", "ignored-local-token")
	local := NewGateway(a)
	r := httptest.NewRequest("GET", "http://localhost/api/nas/roots", nil)
	r.Header.Set(fnos.GatewayUIDHeader, "1001")
	if _, err = local.Roots(r.Context(), testUser); !errors.Is(err, ErrUnavailable) {
		t.Fatal("local mode trusted spoofed gateway identity")
	}
}
