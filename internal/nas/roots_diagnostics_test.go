package nas

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"xiaoniubawang/internal/fnos"
)

func fixtureGateway(t *testing.T, body string) *Gateway {
	t.Helper()
	return &Gateway{enabled: true, token: "test-only", appName: "xiaoniubawang", client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		var payload struct {
			AppName string `json:"appName"`
			Data    struct {
				UID int64 `json:"uid"`
			} `json:"data"`
		}
		if json.NewDecoder(r.Body).Decode(&payload) != nil || payload.AppName != "xiaoniubawang" || payload.Data.UID != 1000 {
			t.Fatal("request did not use numeric current-user UID1000")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}}
}

func TestGatewayRootsStrictSchema(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		count      int
		err        error
	}{
		{"empty", `{"code":0,"data":{"paths":[]}}`, 0, nil},
		{"valid", `{"code":0,"data":{"paths":["/vol1/1000/roms"]}}`, 1, nil},
		{"missing", `{"code":0,"data":{}}`, 0, ErrUnavailable},
		{"null_data", `{"code":0,"data":null}`, 0, ErrUnavailable},
		{"null_paths", `{"code":0,"data":{"paths":null}}`, 0, ErrUnavailable},
		{"nested", `{"code":0,"data":{"data":{"paths":["/vol1/1000/roms"]}}}`, 0, ErrUnavailable},
		{"array_data", `{"code":0,"data":["/vol1/1000/roms"]}`, 0, ErrUnavailable},
		{"string_paths", `{"code":0,"data":{"paths":"/vol1/1000/roms"}}`, 0, ErrUnavailable},
		{"object_path", `{"code":0,"data":{"paths":[{"path":"/vol1/1000/roms"}]}}`, 0, ErrUnavailable},
		{"null_path", `{"code":0,"data":{"paths":[null]}}`, 0, ErrUnavailable},
		{"nonzero", `{"code":1,"data":{"paths":[]}}`, 0, ErrUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			paths, err := fixtureGateway(t, tc.body).Roots(context.Background(), "uid-1000")
			if !errors.Is(err, tc.err) || len(paths) != tc.count || (tc.err == nil && paths == nil) {
				t.Fatalf("count=%d err=%v", len(paths), err)
			}
		})
	}
}

func TestGatewayACLStrictReadable(t *testing.T) {
	for _, tc := range []struct {
		name, data string
		readable   bool
		err        error
	}{
		{"true", `[{"path":"/vol1/1000/roms","readable":true}]`, true, nil},
		{"false", `[{"path":"/vol1/1000/roms","readable":false}]`, false, nil},
		{"missing", `[{"path":"/vol1/1000/roms"}]`, false, ErrUnavailable},
		{"null", `[{"path":"/vol1/1000/roms","readable":null}]`, false, ErrUnavailable},
		{"string", `[{"path":"/vol1/1000/roms","readable":"true"}]`, false, ErrUnavailable},
		{"single_object", `{"path":"/vol1/1000/roms","readable":true}`, false, ErrUnavailable},
		{"wrong_path", `[{"path":"/vol1/other","readable":true}]`, false, ErrDenied},
		{"empty", `[]`, false, ErrDenied},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ok, err := fixtureGateway(t, `{"code":0,"data":`+tc.data+`}`).Readable(context.Background(), "uid-1000", "/vol1/1000/roms")
			if ok != tc.readable || !errors.Is(err, tc.err) {
				t.Fatalf("ok=%v err=%v", ok, err)
			}
		})
	}
}

type diagnosticAuth struct {
	paths  []string
	denied map[string]bool
	user   fnos.User
}

func (a diagnosticAuth) Roots(_ context.Context, user fnos.User) ([]string, error) {
	if user != a.user {
		return []string{}, nil
	}
	return a.paths, nil
}
func (a diagnosticAuth) Readable(_ context.Context, user fnos.User, path string) (bool, error) {
	return user == a.user && !a.denied[path], nil
}

func TestRootsDetailedSafeDiagnostics(t *testing.T) {
	base := tempDir(t)
	good := filepath.Join(base, "readable")
	if err := os.Mkdir(good, 0700); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(base, "private-missing-name")
	denied := filepath.Join(base, "private-denied-name")
	link := filepath.Join(base, "private-link-name")
	if err := os.Symlink(good, link); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name  string
		paths []string
		want  RootDiagnostics
		err   error
	}{
		{"genuine_empty", []string{}, RootDiagnostics{}, nil},
		{"mixed", []string{good, missing, denied, "relative-private", good}, RootDiagnostics{Authorized: 5, Usable: 1, InvalidPath: 1, ACLDenied: 1, DirectoryUnreadable: 1, Duplicate: 1}, nil},
		{"all_missing", []string{missing}, RootDiagnostics{Authorized: 1, DirectoryUnreadable: 1}, ErrDirectoryUnreadable},
		{"all_denied", []string{denied}, RootDiagnostics{Authorized: 1, ACLDenied: 1}, ErrDenied},
		{"all_invalid", []string{"relative-private"}, RootDiagnostics{Authorized: 1, InvalidPath: 1}, ErrPath},
		{"symlink", []string{link}, RootDiagnostics{Authorized: 1, DirectoryUnreadable: 1}, ErrDirectoryUnreadable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := New(diagnosticAuth{tc.paths, map[string]bool{denied: true}, testUser}, nil)
			result, err := s.RootsDetailed(context.Background(), testUser)
			if !errors.Is(err, tc.err) || result.Diagnostics != tc.want || result.Roots == nil {
				t.Fatalf("result=%+v err=%v", result, err)
			}
			data, _ := json.Marshal(result)
			for _, secret := range []string{base, "private-missing-name", "private-denied-name", "private-link-name", "relative-private", string(testUser)} {
				if bytes.Contains(data, []byte(secret)) {
					t.Fatalf("diagnostics leaked private value")
				}
			}
			other, err := s.RootsDetailed(context.Background(), "uid-1002")
			if err != nil || len(other.Roots) != 0 || other.Diagnostics != (RootDiagnostics{}) {
				t.Fatalf("cross-user diagnostic leak %+v %v", other, err)
			}
			compat, compatErr := s.Roots(context.Background(), testUser)
			if len(compat) != len(result.Roots) || !errors.Is(compatErr, tc.err) {
				t.Fatal("Roots compatibility mismatch")
			}
		})
	}
}
