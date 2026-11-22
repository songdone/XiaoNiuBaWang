package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"

	"xiaoniubawang/internal/fnos"
	"xiaoniubawang/internal/library"
	"xiaoniubawang/internal/store"
)

const marker = "backend-test-user"

type testAPI struct {
	t      *testing.T
	client *http.Client
	url    string
}

func startAPI(t *testing.T, data string, mode fnos.Mode, testUser string, setup func(*Config)) *testAPI {
	t.Helper()
	st, err := store.Open(t.Context(), data)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	lib, err := library.New(t.Context(), st, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = lib.Close() })
	auth, err := fnos.NewAuth(mode, testUser)
	if err != nil {
		t.Fatal(err)
	}
	cfg := Config{Store: st, Library: lib, Auth: auth, Version: "test", BuildID: "example"}
	if setup != nil {
		setup(&cfg)
	}
	h, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Close() })
	server := httptest.NewUnstartedServer(h)
	server.Config.ConnContext = fnos.ConnContext
	if mode == fnos.Local {
		server.Start()
		t.Cleanup(server.Close)
		return &testAPI{t, server.Client(), server.URL}
	}
	_ = server.Listener.Close()
	// macOS limits the Unix socket pathname to 103 bytes. Use the short
	// package-relative directory rather than the longer Go test temp path.
	dir, err := os.MkdirTemp(".", ".sock-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	socket, err := filepath.Abs(filepath.Join(dir, "g"))
	if err != nil {
		t.Fatal(err)
	}
	ln, closeSocket, err := fnos.ListenGateway(socket)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(closeSocket)
	server.Listener = ln
	server.Start()
	t.Cleanup(server.Close)
	tr := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", socket)
	}}
	t.Cleanup(tr.CloseIdleConnections)
	return &testAPI{t, &http.Client{Transport: tr}, "http://gateway.test"}
}

type testResponse struct {
	status int
	header http.Header
	body   []byte
}

func (a *testAPI) request(method, path string, body io.Reader, headers ...string) testResponse {
	a.t.Helper()
	req, err := http.NewRequestWithContext(a.t.Context(), method, a.url+path, body)
	if err != nil {
		a.t.Fatal(err)
	}
	for i := 0; i < len(headers); i += 2 {
		if headers[i] == "Host" {
			req.Host = headers[i+1]
		} else {
			req.Header.Add(headers[i], headers[i+1])
		}
	}
	resp, err := a.client.Do(req)
	if err != nil {
		a.t.Error(err)
		return testResponse{}
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		a.t.Error(err)
	}
	return testResponse{resp.StatusCode, resp.Header, data}
}

func expect(t *testing.T, v testResponse, status int) {
	t.Helper()
	if v.status != status {
		output := v.body
		if len(output) > 300 {
			output = output[:300]
		}
		t.Fatalf("got HTTP %d, want %d: %q", v.status, status, output)
	}
}

func decode[T any](t *testing.T, v testResponse) (out T) {
	t.Helper()
	if err := json.Unmarshal(v.body, &out); err != nil {
		t.Fatalf("decode HTTP %d: %v", v.status, err)
	}
	return out
}

func validROM(fill byte) []byte {
	b := make([]byte, 16384+16)
	copy(b, "NES\x1a")
	b[4], b[32] = 1, fill
	return b
}

func sum(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

type upload struct {
	field, name string
	data        []byte
}

func multi(t *testing.T, files []upload, fields map[string]string) (*bytes.Buffer, string) {
	t.Helper()
	b := &bytes.Buffer{}
	w := multipart.NewWriter(b)
	for name, val := range fields {
		if err := w.WriteField(name, val); err != nil {
			t.Fatal(err)
		}
	}
	for _, file := range files {
		p, err := w.CreateFormFile(file.field, file.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := p.Write(file.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b, w.FormDataContentType()
}

func (a *testAPI) importGame(p string, rom []byte, auth ...string) store.Game {
	a.t.Helper()
	b, typ := multi(a.t, []upload{{"file", "合法.nes", rom}}, nil)
	v := a.request("POST", p+"/api/games", b, append(auth, "Content-Type", typ)...)
	expect(a.t, v, 201)
	return decode[struct{ Game store.Game }](a.t, v).Game
}

func TestLocalAuthenticationAndImportInput(t *testing.T) {
	a := startAPI(t, filepath.Join(t.TempDir(), "data"), fnos.Local, marker, nil)
	expect(t, a.request("GET", "/api/health", nil), 200)
	expect(t, a.request("GET", "/api/games", nil, fnos.GatewayUIDHeader, "99"), 401)
	expect(t, a.request("GET", "/api/games", nil, fnos.DevUserHeader, "wrong"), 401)
	expect(t, a.request("GET", "/api/games", nil, fnos.DevUserHeader, marker, fnos.DevUserHeader, marker), 401)
	expect(t, a.request("GET", "/api/games", nil, fnos.DevUserHeader, marker, "Host", "not-loopback.test"), 403)
	expect(t, a.request("GET", "/api/games", nil, fnos.DevUserHeader, marker, "Origin", "https://malicious.test"), 403)
	for _, p := range []string{"/api/games/%2e%2e/x", "/api/games/x%2fy", "/api/games/x%5cy", "/api/games/%252e%252e", "/api//saves"} {
		expect(t, a.request("GET", p, nil, fnos.DevUserHeader, marker), 400)
	}
	for _, tc := range []struct {
		name   string
		files  []upload
		status int
	}{
		{"parent", []upload{{"file", "../bad.nes", validROM(1)}}, 400},
		{"windows", []upload{{"file", `C:\device\wrong.nes`, validROM(1)}}, 400},
		{"bad-magic", []upload{{"file", "bad.nes", []byte("unrelated")}}, 415},
		{"mixed-batch-is-atomic", []upload{{"files", "good.nes", validROM(1)}, {"files", "bad.nes", validROM(1)[:16]}}, 415},
		{"oversize", []upload{{"file", "big.nes", make([]byte, library.MaxROMSize+1)}}, 413},
	} {
		t.Run(tc.name, func(t *testing.T) {
			b, typ := multi(t, tc.files, nil)
			expect(t, a.request("POST", "/api/games", b, fnos.DevUserHeader, marker, "Content-Type", typ), tc.status)
		})
	}
	r := a.request("GET", "/api/library", nil, fnos.DevUserHeader, marker)
	expect(t, r, 200)
	if string(r.body) != "{\"games\":[],\"stats\":{\"favorites\":0,\"recent\":0,\"total\":0}}\n" {
		t.Fatalf("unexpected library after rejected imports: %s", r.body)
	}
}

func TestGatewayDurabilityACLAndSnapshotConflict(t *testing.T) {
	data := filepath.Join(t.TempDir(), "data")
	a := startAPI(t, data, fnos.Gateway, "", nil)
	pre := fnos.GatewayPrefix
	u1 := []string{fnos.GatewayUIDHeader, "1001"}
	u2 := []string{fnos.GatewayUIDHeader, "1002"}
	anon := a.request("GET", pre+"/api/health", nil)
	expect(t, anon, 200)
	if bytes.Contains(anon.body, []byte("csrfToken")) {
		t.Fatal("anonymous health exposed csrf token")
	}
	expect(t, a.request("GET", pre+"/api/games", nil, fnos.DevUserHeader, marker), 401)
	for _, x := range []string{"1,2", "000", "-1001", "9223372036854775808", "8.5"} {
		expect(t, a.request("GET", pre+"/api/games", nil, fnos.GatewayUIDHeader, x), 401)
	}
	expect(t, a.request("GET", pre+"/api/games", nil, fnos.GatewayUIDHeader, "1", fnos.GatewayUIDHeader, "2"), 401)
	h := a.request("GET", pre+"/api/health", nil, u1...)
	expect(t, h, 200)
	token := decode[struct{ CSRFToken string }](t, h).CSRFToken
	if len(token) != 64 {
		t.Fatalf("invalid token length %d", len(token))
	}
	expect(t, a.request("PUT", pre+"/api/settings", strings.NewReader(`{"volume":0.5}`), u1[0], u1[1], "Content-Type", "application/json"), 403)
	expect(t, a.request("PUT", pre+"/api/settings", strings.NewReader(`{"volume":0.5}`), u2[0], u2[1], fnos.CSRFHeader, token, "Content-Type", "application/json"), 403)
	u1w := []string{u1[0], u1[1], fnos.CSRFHeader, token}
	rom := validROM(42)
	g := a.importGame(pre, rom, u1w...)
	if g.SHA256 != sum(rom) || g.Size != int64(len(rom)) || g.Source != "imported" || g.BlobKey != "" {
		t.Fatalf("bad metadata: %+v", g)
	}
	if dup := a.importGame(pre, rom, u1w...); dup.ID != g.ID {
		t.Fatal("duplicate ROM replaced the original")
	}
	game := pre + "/api/games/" + g.ID
	expect(t, a.request("GET", game, nil, u2...), 404)
	expect(t, a.request("GET", game+"/launch", nil, u2...), 404)
	r := a.request("POST", game+"/launch", nil, u1w...)
	expect(t, r, 200)
	if !strings.Contains(string(r.body), pre+"/api/games/") {
		t.Fatalf("missing launch URL: %s", r.body)
	}
	r = a.request("GET", game+"/launch", nil, u1...)
	expect(t, r, 200)
	if !bytes.Equal(r.body, rom) {
		t.Fatal("wrong ROM content")
	}
	expect(t, a.request("PUT", game+"/favorite", strings.NewReader(`{"favorite":true}`), append(u1w, "Content-Type", "application/json")...), 200)
	expect(t, a.request("PUT", pre+"/api/settings", strings.NewReader(`{"volume":0.5}`), append(u1w, "Content-Type", "application/json")...), 200)
	if v := a.request("GET", pre+"/api/settings", nil, u2...); string(v.body) != "{}\n" {
		t.Fatalf("settings crossed users: %s", v.body)
	}
	create := func(kind string, slot int, digest string, payload []byte) testResponse {
		b, typ := multi(t, []upload{{"file", "ignored.bin", payload}}, map[string]string{"gameId": g.ID, "kind": kind,
			"slot": strconv.Itoa(slot), "core": "fceumm", "coreVersion": "0.98.1", "romSha256": digest, "sha256": sum(payload)})
		return a.request("POST", pre+"/api/saves", b, append(u1w, "Content-Type", typ)...)
	}
	expect(t, create("state", 1, sum(validROM(7)), []byte("first")), 409)
	expect(t, create("sram", 1, g.SHA256, []byte("first")), 400)
	expect(t, create("sram", 0, g.SHA256, make([]byte, (1<<20)+1)), 413)
	expect(t, create("sram", 0, g.SHA256, []byte("sram")), 201)
	r = create("state", 1, g.SHA256, []byte("first"))
	expect(t, r, 201)
	v1 := decode[saveResponse](t, r)
	if v1.Version != 1 || v1.SHA256 != sum([]byte("first")) || v1.ETag == "" || v1.ETag != r.header.Get("ETag") || !strings.HasPrefix(v1.URL, pre+"/api/saves/") {
		t.Fatalf("incorrect snapshot metadata: %+v", v1)
	}
	expect(t, create("state", 1, g.SHA256, []byte("duplicate")), 409)
	expect(t, a.request("GET", pre+"/api/saves?game="+g.ID, nil, u2...), 404)
	expect(t, a.request("GET", v1.URL, nil, u2...), 404)
	expect(t, a.request("PUT", v1.URL, strings.NewReader("bad"), append(u1w, "Content-Type", "application/octet-stream")...), 428)
	expect(t, a.request("PUT", v1.URL, strings.NewReader("bad"), append(u1w, "Content-Type", "application/octet-stream", "If-Match", "*")...), 400)
	expect(t, a.request("PUT", v1.URL, strings.NewReader("bad"), append(u1w, "Content-Type", "application/octet-stream", "If-Match", v1.ETag, "X-XNBW-Core-Version", "0.99")...), 409)
	var responses [2]testResponse
	var wg sync.WaitGroup
	for i := range responses {
		wg.Go(func() {
			responses[i] = a.request("PUT", v1.URL, strings.NewReader("v"+strconv.Itoa(i)), append(u1w, "Content-Type", "application/octet-stream", "If-Match", v1.ETag)...)
		})
	}
	wg.Wait()
	if responses[0].status == 412 {
		responses[0], responses[1] = responses[1], responses[0]
	}
	expect(t, responses[0], 200)
	expect(t, responses[1], 412)
	v2 := decode[saveResponse](t, responses[0])
	current := decode[struct{ Current saveResponse }](t, responses[1]).Current
	if v2.Version != 2 || v2.ETag == v1.ETag || current.ETag != v2.ETag {
		t.Fatalf("no revision consistency: old=%+v new=%+v conflict=%+v", v1, v2, current)
	}
	expect(t, a.request("DELETE", v1.URL, nil, append(u1w, "If-Match", v1.ETag)...), 412)
	expect(t, a.request("GET", v1.URL, nil, append(u1, "If-None-Match", v2.ETag)...), 304)
	r = a.request("GET", v1.URL, nil, u1...)
	expect(t, r, 200)
	if sum(r.body) != v2.SHA256 || r.header.Get("X-XNBW-SHA256") != v2.SHA256 {
		t.Fatalf("GET did not read the winner: %q", r.body)
	}
	if strings.Contains(string(responses[0].body), data) || strings.Contains(string(responses[1].body), "BlobKey") {
		t.Fatal("API exposed a backing path")
	}
	expect(t, a.request("DELETE", v1.URL, nil, append(u1w, "If-Match", v2.ETag)...), 204)
	expect(t, a.request("GET", v1.URL, nil, u1...), 404)
	r = a.request("GET", pre+"/api/library", nil, u1...)
	expect(t, r, 200)
	if !strings.Contains(string(r.body), `"recent":1`) || !strings.Contains(string(r.body), `"favorite":true`) {
		t.Fatalf("activity not persisted: %s", r.body)
	}
}
