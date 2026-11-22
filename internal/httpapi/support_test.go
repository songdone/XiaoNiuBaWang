package httpapi

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"xiaoniubawang/internal/fnos"
)

func TestApprovedSupportAssetsAndAuthorizationCallback(t *testing.T) {
	root := t.TempDir()
	web := filepath.Join(root, "web")
	support := filepath.Join(root, "support")
	for _, dir := range []string{web, support} {
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	callback := []byte("<!doctype html><html lang=\"zh-CN\">授权返回</html>")
	if err := os.WriteFile(filepath.Join(web, "fnos-callback.html"), callback, 0600); err != nil {
		t.Fatal(err)
	}
	images := map[string][]byte{
		"wechat-6uos.jpg": {0xff, 0xd8, 0xff, 0, 7, 19},
		"alipay-6uos.jpg": {0xff, 0xd8, 0xff, 1, 8, 20},
	}
	for name, data := range images {
		if err := os.WriteFile(filepath.Join(support, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(support, "extra.jpg"), images["wechat-6uos.jpg"], 0600); err != nil {
		t.Fatal(err)
	}
	for _, approved := range []bool{false, true} {
		name := "disabled"
		if approved {
			name = "approved"
		}
		t.Run(name, func(t *testing.T) {
			data := t.TempDir()
			if err := os.Chmod(data, 0700); err != nil {
				t.Fatal(err)
			}
			a := startAPI(t, data, fnos.Local, marker, func(c *Config) {
				c.WebRoot, c.SupportRoot, c.ApproveSupport, c.SupportDisabled = web, support, approved, !approved
			})
			r := a.request("GET", "/api/support-assets", nil, fnos.DevUserHeader, marker)
			expect(t, r, 200)
			list := decode[struct{ Assets []supportAsset }](t, r).Assets
			want := 0
			status := 404
			if approved {
				want, status = 2, 200
			}
			if len(list) != want {
				t.Fatalf("support assets: got %d, want %d", len(list), want)
			}
			for file, data := range images {
				r = a.request("GET", "/support-assets/"+file, nil)
				expect(t, r, status)
				if approved && (!bytes.Equal(r.body, data) || r.header.Get("Content-Type") != "image/jpeg") {
					t.Fatalf("original image changed or wrong MIME: %s", file)
				}
			}
			expect(t, a.request("GET", "/support-assets/extra.jpg", nil), 404)
			r = a.request("GET", "/fnos-callback.html", nil)
			expect(t, r, 200)
			if !bytes.Equal(r.body, callback) {
				t.Fatal("authorization callback changed")
			}
			expect(t, a.request("GET", "/unapproved-callback.html", nil), 404)
		})
	}
}

func TestSupportRuntimeFailureIsNotUnconfigured(t *testing.T) {
	for _, approved := range []bool{false, true} {
		t.Run(map[bool]string{false: "launch_validation_failed", true: "approved_files_missing"}[approved], func(t *testing.T) {
			data, support := t.TempDir(), t.TempDir()
			if err := os.Chmod(data, 0700); err != nil {
				t.Fatal(err)
			}
			a := startAPI(t, data, fnos.Local, marker, func(c *Config) {
				c.SupportRoot, c.ApproveSupport = support, approved
			})
			response := a.request("GET", "/api/support-assets", nil, fnos.DevUserHeader, marker)
			expect(t, response, 503)
			if !bytes.Contains(response.body, []byte(`"code":"support_unavailable"`)) {
				t.Fatalf("runtime failure must be explicit: %s", response.body)
			}
		})
	}
}

func TestSupportRejectsInvalidOriginalAndSymlink(t *testing.T) {
	support := t.TempDir()
	if err := os.WriteFile(filepath.Join(support, "wechat-6uos.jpg"), []byte("not JPEG"), 0600); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "image.jpg")
	if err := os.WriteFile(outside, []byte{0xff, 0xd8, 0xff, 1}, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(support, "alipay-6uos.jpg")); err != nil {
		t.Fatal(err)
	}
	data := t.TempDir()
	if err := os.Chmod(data, 0700); err != nil {
		t.Fatal(err)
	}
	a := startAPI(t, data, fnos.Local, marker, func(c *Config) {
		c.SupportRoot, c.ApproveSupport = support, true
	})
	for _, name := range []string{"wechat-6uos.jpg", "alipay-6uos.jpg"} {
		expect(t, a.request("GET", "/support-assets/"+name, nil), 404)
	}
}
