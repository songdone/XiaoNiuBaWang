package extensions

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"xiaoniubawang/internal/backup"
	"xiaoniubawang/internal/fnos"
	"xiaoniubawang/internal/httpapi"
	"xiaoniubawang/internal/library"
	"xiaoniubawang/internal/nas"
	"xiaoniubawang/internal/saves"
	"xiaoniubawang/internal/store"
)

const user fnos.User = "uid-1001"

type testCore struct {
	store   *store.Store
	lib     *library.Service
	auth    *fnos.Auth
	handler *Handler
	api     *httpapi.Handler
}

func core(t *testing.T, mode fnos.Mode) *testCore {
	t.Helper()
	data := t.TempDir()
	if err := os.Chmod(data, 0700); err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(context.Background(), data)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	lib, err := library.New(context.Background(), st, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	marker := ""
	if mode == fnos.Local {
		marker = "test"
	}
	auth, err := fnos.NewAuth(mode, marker)
	if err != nil {
		t.Fatal(err)
	}
	h := New(Config{Store: st, Library: lib, Auth: auth})
	t.Cleanup(func() { h.Close() })
	api, err := httpapi.New(httpapi.Config{Store: st, Library: lib, Auth: auth, Extension: h.Handle})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { api.Close() })
	return &testCore{st, lib, auth, h, api}
}
func fixtureROM() []byte { b := make([]byte, 16+16384); copy(b, "NES\x1a"); b[4] = 1; return b }
func seed(t *testing.T, c *testCore, u fnos.User) store.Game {
	t.Helper()
	games, err := c.lib.Import(context.Background(), u, []library.Upload{{Filename: "fixture.nes", Reader: bytes.NewReader(fixtureROM())}})
	if err != nil {
		t.Fatal(err)
	}
	sv := saves.New(c.store, c.lib)
	if _, err = sv.Create(context.Background(), u, saves.Input{GameID: games[0].ID, Kind: "state", Slot: 2, Core: "fceumm", CoreVersion: "test-v1", ROMSHA256: games[0].SHA256}, bytes.NewReader([]byte{0, 255, 0, 7, 8, 9})); err != nil {
		t.Fatal(err)
	}
	return games[0]
}
func direct(t *testing.T, h *Handler, u fnos.User, method, path string, body io.Reader, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, "http://localhost"+path, body)
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	w := httptest.NewRecorder()
	if !h.Handle(w, r, u) {
		t.Fatalf("route unhandled %s", path)
	}
	return w
}
func multipartBody(t *testing.T, data []byte, field string, twice bool) ([]byte, string) {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for i := 0; i < 1+boolInt(twice); i++ {
		part, err := mw.CreateFormFile(field, "backup.zip")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = part.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	return body.Bytes(), mw.FormDataContentType()
}
func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func TestBackupHTTPBinaryAndMultipartRoundTrip(t *testing.T) {
	source := core(t, fnos.Gateway)
	seed(t, source, user)
	w := direct(t, source.handler, user, "GET", "/api/backup", nil, "")
	if w.Code != 200 || w.Header().Get("Content-Type") != "application/zip" || !strings.Contains(w.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("download code=%d headers=%v", w.Code, w.Header())
	}
	zr, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil || len(zr.File) < 3 {
		t.Fatalf("invalid ZIP %v", err)
	}
	dest := core(t, fnos.Gateway)
	body, ct := multipartBody(t, w.Body.Bytes(), "file", false)
	restored := direct(t, dest.handler, user, "POST", "/api/backup/restore", bytes.NewReader(body), ct)
	if restored.Code != 200 {
		t.Fatalf("restore HTTP%d %s", restored.Code, restored.Body.String())
	}
	var result backup.RestoreResult
	if json.Unmarshal(restored.Body.Bytes(), &result) != nil || result.ImportedGames != 1 || result.RestoredSaves != 1 {
		t.Fatalf("restore %+v", result)
	}
	games, err := dest.lib.List(context.Background(), user)
	if err != nil || len(games) != 1 {
		t.Fatal("HTTP restore missing game")
	}
	sv := saves.New(dest.store, dest.lib)
	slots, err := sv.List(context.Background(), user, games[0].ID)
	if err != nil || len(slots) != 1 {
		t.Fatal("HTTP restore missing save")
	}
	_, f, err := sv.Open(context.Background(), user, slots[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := io.ReadAll(f)
	f.Close()
	if err != nil || !bytes.Equal(actual, []byte{0, 255, 0, 7, 8, 9}) {
		t.Fatal("HTTP roundtrip state bytes differ")
	}
	for _, field := range []string{"wrong", "file"} {
		body, ct := multipartBody(t, w.Body.Bytes(), field, field == "file")
		bad := direct(t, dest.handler, user, "POST", "/api/backup/restore", bytes.NewReader(body), ct)
		if bad.Code != 400 {
			t.Fatalf("multipart accepted field=%s code=%d", field, bad.Code)
		}
	}
	head := direct(t, source.handler, user, "HEAD", "/api/backup", nil, "")
	if head.Code != 200 || head.Body.Len() != 0 {
		t.Fatal("HEAD returned body")
	}
}

type folderAuth struct {
	root     string
	readable atomic.Bool
}

func (a *folderAuth) Roots(ctx context.Context, u fnos.User) ([]string, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if u != user {
		return []string{}, nil
	}
	return []string{a.root}, nil
}
func (a *folderAuth) Readable(ctx context.Context, u fnos.User, p string) (bool, error) {
	if ctx.Err() != nil {
		return false, ctx.Err()
	}
	return u == user && a.readable.Load(), nil
}
func fakeNAS(t *testing.T, c *testCore) (string, *folderAuth) {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, "one.nes"), fixtureROM(), 0600); err != nil {
		t.Fatal(err)
	}
	a := &folderAuth{root: root}
	a.readable.Store(true)
	c.handler.scanner.Close()
	c.handler.nas = nas.New(a, c.lib)
	c.handler.scanner = nas.NewScanner(c.handler.nas)
	return root, a
}
func TestNASHTTPReferencesAndNoPhysicalPathLeak(t *testing.T) {
	c := core(t, fnos.Gateway)
	root, acl := fakeNAS(t, c)
	w := direct(t, c.handler, user, "GET", "/api/nas/roots", nil, "")
	var roots struct {
		Roots []nas.Root `json:"roots"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &roots) != nil || len(roots.Roots) != 1 {
		t.Fatalf("roots %s", w.Body.String())
	}
	key := roots.Roots[0].Path
	if strings.Contains(w.Body.String(), root) || !strings.HasPrefix(key, "nas_") {
		t.Fatal("absolute root exposed")
	}
	w = direct(t, c.handler, user, "GET", "/api/nas/browse?path="+url.QueryEscape(key), nil, "")
	var list nas.Listing
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &list) != nil || len(list.Entries) != 1 || strings.Contains(w.Body.String(), root) {
		t.Fatalf("browse %d %s", w.Code, w.Body.String())
	}
	w = direct(t, c.handler, user, "GET", "/api/nas/browse?path="+url.QueryEscape(root), nil, "")
	if w.Code != 400 || strings.Contains(w.Body.String(), root) {
		t.Fatal("raw path accepted or echoed")
	}
	w = direct(t, c.handler, "uid-1002", "GET", "/api/nas/browse?path="+url.QueryEscape(key), nil, "")
	if w.Code != 410 || !strings.Contains(w.Body.String(), "nas_refresh_required") {
		t.Fatalf("cross-user handle %d %s", w.Code, w.Body.String())
	}
	body, _ := json.Marshal(map[string]any{"paths": []string{list.Entries[0].Path}})
	w = direct(t, c.handler, user, "POST", "/api/nas/import", bytes.NewReader(body), "application/json")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"imported":1`) || strings.Contains(w.Body.String(), root) {
		t.Fatalf("import %d %s", w.Code, w.Body.String())
	}
	scanBody, _ := json.Marshal(map[string]string{"path": key})
	w = direct(t, c.handler, user, "POST", "/api/nas/scan", bytes.NewReader(scanBody), "application/json")
	var job nas.Job
	if w.Code != 202 || json.Unmarshal(w.Body.Bytes(), &job) != nil || job.Path != key || strings.Contains(w.Body.String(), root) {
		t.Fatalf("scan %d %s", w.Code, w.Body.String())
	}
	deadline := time.Now().Add(3 * time.Second)
	for job.Status == "queued" || job.Status == "running" {
		if time.Now().After(deadline) {
			t.Fatal("scan timeout")
		}
		w = direct(t, c.handler, user, "GET", "/api/nas/scan/"+job.ID, nil, "")
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &job) != nil {
			t.Fatal("job poll failed")
		}
	}
	if job.Status != "completed" || job.Imported != 0 || job.Skipped != 1 {
		t.Fatalf("job %+v", job)
	}
	w = direct(t, c.handler, "uid-1002", "DELETE", "/api/nas/scan/"+job.ID, nil, "")
	if w.Code != 404 {
		t.Fatal("other user cancelled job")
	}
	acl.readable.Store(false)
	w = direct(t, c.handler, user, "GET", "/api/nas/browse?path="+url.QueryEscape(key), nil, "")
	if w.Code != 403 {
		t.Fatalf("revoked handle %d", w.Code)
	}
	w = direct(t, c.handler, user, "POST", "/api/nas/import", bytes.NewReader(body), "application/json")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "access_denied") || strings.Contains(w.Body.String(), root) {
		t.Fatalf("revoked import %s", w.Body.String())
	}
}

func TestNASRootsDiagnosticsAndRejectedErrors(t *testing.T) {
	c := core(t, fnos.Gateway)
	root, acl := fakeNAS(t, c)
	decode := func(w *httptest.ResponseRecorder) (nas.RootDiagnostics, string) {
		t.Helper()
		var body struct {
			Available   bool                `json:"available"`
			Roots       []nas.Root          `json:"roots"`
			Diagnostics nas.RootDiagnostics `json:"diagnostics"`
			Code        string              `json:"code"`
		}
		if json.Unmarshal(w.Body.Bytes(), &body) != nil || !body.Available || body.Roots == nil {
			t.Fatalf("invalid roots response: %d %s", w.Code, w.Body.String())
		}
		if strings.Contains(w.Body.String(), root) || strings.Contains(w.Body.String(), string(user)) {
			t.Fatal("roots response exposed physical path or namespace")
		}
		return body.Diagnostics, body.Code
	}
	w := direct(t, c.handler, user, "GET", "/api/nas/roots", nil, "")
	d, code := decode(w)
	if w.Code != 200 || code != "" || d != (nas.RootDiagnostics{Authorized: 1, Usable: 1}) {
		t.Fatalf("valid diagnostics %+v %d", d, w.Code)
	}
	acl.readable.Store(false)
	w = direct(t, c.handler, user, "GET", "/api/nas/roots", nil, "")
	d, code = decode(w)
	if w.Code != 403 || code != "access_denied" || d.ACLDenied != 1 || d.Usable != 0 {
		t.Fatalf("ACL denial swallowed: %d %s", w.Code, w.Body.String())
	}
	acl.readable.Store(true)
	acl.root = filepath.Join(root, "private-missing-name")
	w = direct(t, c.handler, user, "GET", "/api/nas/roots", nil, "")
	d, code = decode(w)
	if w.Code != 403 || code != "nas_directory_unreadable" || d.DirectoryUnreadable != 1 || strings.Contains(w.Body.String(), "private-missing-name") {
		t.Fatalf("open failure swallowed or exposed: %d %s", w.Code, w.Body.String())
	}
	w = direct(t, c.handler, "uid-1002", "GET", "/api/nas/roots", nil, "")
	d, code = decode(w)
	if w.Code != 200 || code != "" || d != (nas.RootDiagnostics{}) {
		t.Fatalf("other-user grant diagnostics exposed: %d %s", w.Code, w.Body.String())
	}
	w = direct(t, c.handler, user, "HEAD", "/api/nas/roots", nil, "")
	if w.Code != 403 || w.Body.Len() != 0 {
		t.Fatal("HEAD unreadable response returned body")
	}
}

type interruptedFolderAuth struct{ paths []string }

func (a interruptedFolderAuth) Roots(context.Context, fnos.User) ([]string, error) {
	return a.paths, nil
}
func (a interruptedFolderAuth) Readable(context.Context, fnos.User, string) (bool, error) {
	return false, nas.ErrDenied
}

func TestNASInterruptedRootsDoNotExposePartialDiagnostics(t *testing.T) {
	c := core(t, fnos.Gateway)
	c.handler.nas = nas.New(interruptedFolderAuth{paths: []string{"relative-private", "/vol1/private"}}, nil)
	w := direct(t, c.handler, user, "GET", "/api/nas/roots", nil, "")
	if w.Code != 403 || !strings.Contains(w.Body.String(), "access_denied") {
		t.Fatalf("unexpected interrupted result %d %s", w.Code, w.Body.String())
	}
	for _, field := range []string{"diagnostics", "available", "relative-private", "/vol1/private"} {
		if strings.Contains(w.Body.String(), field) {
			t.Fatal("partial diagnostics or private path leaked")
		}
	}
}

func TestLocalNASUnavailableDespiteSpoofedHeaders(t *testing.T) {
	c := core(t, fnos.Local)
	r := httptest.NewRequest("GET", "http://localhost/api/nas/roots", nil)
	r.Header.Set(fnos.GatewayUIDHeader, "1001")
	w := httptest.NewRecorder()
	c.handler.Handle(w, r, user)
	if w.Code != 503 || !strings.Contains(w.Body.String(), "nas_unavailable") || !strings.Contains(w.Body.String(), "飞牛") {
		t.Fatalf("local NAS %d %s", w.Code, w.Body.String())
	}
}

func unixClient(t *testing.T, handler http.Handler) *http.Client {
	t.Helper()
	dir, err := os.MkdirTemp(".", ".sock-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	socket, err := filepath.Abs(filepath.Join(dir, "h.sock"))
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: handler, ConnContext: fnos.ConnContext}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close(); listener.Close() })
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", socket)
	}}
	t.Cleanup(transport.CloseIdleConnections)
	return &http.Client{Transport: transport, Timeout: 3 * time.Second}
}
func request(t *testing.T, client *http.Client, method, path, uid, csrf, ct string, body []byte) (int, []byte) {
	t.Helper()
	r, err := http.NewRequest(method, "http://localhost"+path, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if uid != "" {
		r.Header.Set(fnos.GatewayUIDHeader, uid)
	}
	if csrf != "" {
		r.Header.Set(fnos.CSRFHeader, csrf)
	}
	if ct != "" {
		r.Header.Set("Content-Type", ct)
	}
	response, err := client.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	b, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, b
}
func TestExtensionRunsAfterTransportIdentityAndCSRF(t *testing.T) {
	c := core(t, fnos.Gateway)
	seed(t, c, user)
	client := unixClient(t, c.api)
	status, _ := request(t, client, "GET", fnos.GatewayPrefix+"/api/backup", "", "", "", nil)
	if status != 401 {
		t.Fatalf("unauthenticated backup=%d", status)
	}
	status, data := request(t, client, "GET", fnos.GatewayPrefix+"/api/backup", "1001", "", "", nil)
	if status != 200 {
		t.Fatalf("download=%d %s", status, data)
	}
	body, ct := multipartBody(t, data, "file", false)
	status, _ = request(t, client, "POST", fnos.GatewayPrefix+"/api/backup/restore", "1002", "", ct, body)
	if status != 403 {
		t.Fatalf("missing CSRF=%d", status)
	}
	status, _ = request(t, client, "POST", fnos.GatewayPrefix+"/api/backup/restore", "1002", c.auth.CSRFToken(user), ct, body)
	if status != 403 {
		t.Fatalf("cross-user CSRF=%d", status)
	}
	status, out := request(t, client, "POST", fnos.GatewayPrefix+"/api/backup/restore", "1002", c.auth.CSRFToken("uid-1002"), ct, body)
	if status != 200 {
		t.Fatalf("valid gateway restore=%d %s", status, out)
	}
	// The same headers over an actual TCP connection never become a gateway user.
	tcp := httptest.NewUnstartedServer(c.api)
	tcp.Config.ConnContext = fnos.ConnContext
	tcp.Start()
	defer tcp.Close()
	r, err := http.NewRequest("GET", tcp.URL+"/api/backup", nil)
	if err != nil {
		t.Fatal(err)
	}
	r.Header.Set(fnos.GatewayUIDHeader, "1001")
	response, err := tcp.Client().Do(r)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 401 {
		t.Fatalf("spoofed TCP gateway identity=%d", response.StatusCode)
	}
}

func TestCancelledMultipartReadStops(t *testing.T) {
	body, ct := multipartBody(t, []byte("archive"), "file", false)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r := httptest.NewRequest("POST", "http://localhost/api/backup/restore", bytes.NewReader(body)).WithContext(ctx)
	r.Header.Set("Content-Type", ct)
	f, _, err := restoreUploadToFile(httptest.NewRecorder(), r)
	if f != nil {
		name := f.Name()
		_ = f.Close()
		_ = os.Remove(name)
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled upload %v", err)
	}
}
