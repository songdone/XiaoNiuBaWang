package httpapi

import (
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"strings"
	"syscall"
	"time"

	"xiaoniubawang/internal/library"
)

func openAsset(root *os.Root, name string) (*os.File, error) {
	if root == nil || !safeAssetPath(name) {
		return nil, os.ErrNotExist
	}
	f, err := root.OpenFile(name, os.O_RDONLY|syscall.O_NONBLOCK|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		_ = f.Close()
		return nil, os.ErrNotExist
	}
	return f, nil
}

func safeAssetPath(name string) bool {
	for part := range strings.SplitSeq(name, "/") {
		if !library.SafeFilename(part) {
			return false
		}
	}
	return true
}

type coreResponse struct {
	Available bool   `json:"available"`
	ModuleURL string `json:"moduleUrl,omitempty"`
	Name      string `json:"name,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

func (h *Handler) core() coreResponse {
	const entry = "cores/fceumm.js"
	for _, name := range []string{entry, "cores/fceumm-core.mjs", "cores/fceumm-core.wasm"} {
		f, err := openAsset(h.web, name)
		if err != nil {
			return coreResponse{Reason: "当前未完整安装 FCEUmm 模拟器核心。"}
		}
		info, err := f.Stat()
		_ = f.Close()
		if err != nil || info.Size() == 0 {
			return coreResponse{Reason: "当前未完整安装 FCEUmm 模拟器核心。"}
		}
	}
	return coreResponse{Available: true, ModuleURL: h.prefix() + "/" + entry, Name: "FCEUmm"}
}

type supportAsset struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
	URL   string `json:"url"`
}

var supportFiles = []struct{ file, kind, label string }{
	{"wechat-6uos.jpg", "wechat", "微信支持"},
	{"alipay-6uos.jpg", "alipay", "支付宝支持"},
}

func (h *Handler) supportAssets(w http.ResponseWriter, r *http.Request) {
	if h.cfg.SupportDisabled {
		writeJSON(w, r, http.StatusOK, map[string]any{"assets": []supportAsset{}, "disabled": true})
		return
	}
	if !h.cfg.ApproveSupport || h.support == nil {
		problem(w, r, http.StatusServiceUnavailable, "support_unavailable", "内置赞赏码暂时无法读取，请检查应用安装资源或启动验证日志。")
		return
	}
	assets := make([]supportAsset, 0, len(supportFiles))
	for _, v := range supportFiles {
		if f, err := h.openSupport(v.file); err == nil {
			assets = append(assets, supportAsset{v.kind, v.label, h.prefix() + "/support-assets/" + v.file})
			_ = f.Close()
		}
	}
	if len(assets) != len(supportFiles) {
		problem(w, r, http.StatusServiceUnavailable, "support_unavailable", "内置赞赏码文件不完整或无法读取，请检查应用安装资源。")
		return
	}
	writeJSON(w, r, http.StatusOK, map[string]any{"assets": assets})
}

func (h *Handler) openSupport(name string) (*os.File, error) {
	known := false
	for _, v := range supportFiles {
		known = known || name == v.file
	}
	if !known {
		return nil, os.ErrNotExist
	}
	f, err := openAsset(h.support, name)
	if err != nil {
		return nil, err
	}
	var h3 [3]byte
	if _, err := io.ReadFull(f, h3[:]); err != nil || h3 != [3]byte{0xff, 0xd8, 0xff} {
		_ = f.Close()
		return nil, os.ErrNotExist
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		_ = f.Close()
		return nil, err
	}
	return f, nil
}

func (h *Handler) serveStatic(w http.ResponseWriter, r *http.Request) {
	if !allow(w, r, http.MethodGet, http.MethodHead) {
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/")
	var f *os.File
	var err error
	switch {
	case strings.HasPrefix(name, "support-assets/"):
		f, err = h.openSupport(strings.TrimPrefix(name, "support-assets/"))
	case strings.HasPrefix(name, "games/"):
		f, err = h.cfg.Library.OpenCover(strings.TrimPrefix(name, "games/"))
	case strings.HasPrefix(name, "donation/"):
		// Legacy asset copies must not bypass explicit operator approval.
		f, err = h.openSupport(strings.TrimPrefix(name, "donation/"))
	default:
		switch name {
		case "fnos-callback.html":
			f, err = openAsset(h.web, name)
		case "", "index.html":
			name = "index.html"
			f, err = openAsset(h.web, name)
		default:
			_, _, nested := strings.Cut(name, "/")
			typeName := assetType(name)
			if !nested || typeName == "" || !allowedWebPath(name) {
				err = os.ErrNotExist
			} else {
				f, err = openAsset(h.web, name)
			}
		}
	}
	if err != nil {
		problem(w, r, http.StatusNotFound, "not_found", "未找到资源。")
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", assetType(name))
	http.ServeContent(w, r, path.Base(name), time.Time{}, f)
}

func allowedWebPath(name string) bool {
	first, _, _ := strings.Cut(name, "/")
	switch first {
	case "assets", "brand", "branding", "cores":
		return true
	case "source":
		return name == "source/source.zip"
	case "licenses":
		return strings.EqualFold(path.Ext(name), ".txt")
	default:
		return false
	}
}

func assetType(name string) string {
	ext := strings.ToLower(path.Ext(name))
	switch ext {
	case ".js", ".mjs":
		return "text/javascript; charset=utf-8"
	case ".wasm":
		return "application/wasm"
	case ".zip":
		return "application/zip"
	case ".txt":
		return "text/plain; charset=utf-8"
	case ".html", ".css", ".json", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".wav", ".mp3":
		return mime.TypeByExtension(ext)
	case ".data", ".bin":
		return "application/octet-stream"
	default:
		return ""
	}
}
