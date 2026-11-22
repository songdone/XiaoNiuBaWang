// Package httpapi exposes the application API and optional packaged resources.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"xiaoniubawang/internal/fnos"
	"xiaoniubawang/internal/library"
	"xiaoniubawang/internal/saves"
	"xiaoniubawang/internal/store"
)

type Config struct {
	Store           *store.Store
	Library         *library.Service
	Auth            *fnos.Auth
	Version         string
	BuildID         string
	WebRoot         string
	SupportRoot     string
	ApproveSupport  bool
	SupportDisabled bool
	Extension       func(http.ResponseWriter, *http.Request, fnos.User) bool
}

type Handler struct {
	cfg     Config
	saves   *saves.Service
	web     *os.Root
	support *os.Root
	uploads chan struct{}
}

func New(c Config) (*Handler, error) {
	if c.Store == nil || c.Library == nil || c.Auth == nil {
		return nil, errors.New("HTTP requires configured store, library, and authentication")
	}
	if c.ApproveSupport && c.SupportDisabled {
		return nil, errors.New("approved support and explicit source-only disable are mutually exclusive")
	}
	h := &Handler{cfg: c, saves: saves.New(c.Store, c.Library), uploads: make(chan struct{}, 2)}
	var err error
	if c.WebRoot != "" {
		h.web, err = os.OpenRoot(c.WebRoot)
		if err != nil {
			return nil, fmt.Errorf("open packaged web root: %w", err)
		}
	}
	if c.ApproveSupport {
		h.support, err = os.OpenRoot(c.SupportRoot)
		if err != nil {
			_ = h.Close()
			return nil, fmt.Errorf("open approved support assets: %w", err)
		}
	}
	return h, nil
}

func (h *Handler) Close() error {
	var errs []error
	if h.web != nil {
		errs = append(errs, h.web.Close())
	}
	if h.support != nil {
		errs = append(errs, h.support.Close())
	}
	return errors.Join(errs...)
}

func (h *Handler) prefix() string {
	if h.cfg.Auth.Mode() == fnos.Gateway {
		return fnos.GatewayPrefix
	}
	return ""
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
	w.Header().Set("Cache-Control", "private, no-store")
	if !h.cfg.Auth.ValidHost(r) {
		problem(w, r, http.StatusForbidden, "invalid_host", "此服务只能通过已配置的本地地址访问。")
		return
	}
	p := r.URL.Path
	if r.URL.IsAbs() || !safeURLPath(p, r.URL.EscapedPath()) {
		problem(w, r, http.StatusBadRequest, "invalid_path", "请求路径无效。")
		return
	}
	if pre := h.prefix(); pre != "" && (p == pre || strings.HasPrefix(p, pre+"/")) {
		p = strings.TrimPrefix(p, pre)
		if p == "" {
			p = "/"
		}
		copy := r.Clone(r.Context())
		copy.URL.Path, copy.URL.RawPath = p, ""
		r = copy
	}
	if p != "/api" && !strings.HasPrefix(p, "/api/") {
		h.serveStatic(w, r)
		return
	}
	if !h.cfg.Auth.SameOrigin(r) {
		problem(w, r, http.StatusForbidden, "origin_denied", "请在应用页面内发起请求。")
		return
	}
	user, signed := h.cfg.Auth.Identify(r)
	if p == "/api/health" {
		if allow(w, r, http.MethodGet, http.MethodHead) {
			h.health(w, r, user, signed)
		}
		return
	}
	if !signed {
		problem(w, r, http.StatusUnauthorized, "authentication_required", "请从飞牛桌面登录打开应用，或使用已配置的本地测试用户。")
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead && !h.cfg.Auth.ValidMutation(r, user) {
		problem(w, r, http.StatusForbidden, "csrf_required", "登录校验已失效，请刷新应用后重试。")
		return
	}
	parts := strings.Split(strings.TrimPrefix(p, "/api/"), "/")
	switch {
	case p == "/api/library":
		if allow(w, r, http.MethodGet, http.MethodHead) {
			h.listGames(w, r, user, true)
		}
	case p == "/api/games":
		if allow(w, r, http.MethodGet, http.MethodHead, http.MethodPost) {
			if r.Method == http.MethodPost {
				h.importGames(w, r, user)
			} else {
				h.listGames(w, r, user, false)
			}
		}
	case len(parts) >= 2 && len(parts) <= 3 && parts[0] == "games":
		h.game(w, r, user, parts[1:])
	case p == "/api/saves":
		h.saveCollection(w, r, user)
	case len(parts) == 2 && parts[0] == "saves":
		h.save(w, r, user, parts[1])
	case p == "/api/settings":
		h.settings(w, r, user)
	case p == "/api/support-assets":
		if allow(w, r, http.MethodGet, http.MethodHead) {
			h.supportAssets(w, r)
		}
	default:
		if h.cfg.Extension == nil || !h.cfg.Extension(w, r, user) {
			problem(w, r, http.StatusNotFound, "not_found", "未找到所请求的内容。")
		}
	}
}

func safeURLPath(p, escaped string) bool {
	if !strings.HasPrefix(p, "/") || len(p) > 4096 || strings.ContainsAny(p, "\\\x00%") || strings.Contains(p, "//") {
		return false
	}
	escaped = strings.ToLower(escaped)
	if strings.Contains(escaped, "%2f") || strings.Contains(escaped, "%5c") {
		return false
	}
	for a := range strings.SplitSeq(p, "/") {
		if a == "." || a == ".." {
			return false
		}
	}
	return true
}

func (h *Handler) health(w http.ResponseWriter, r *http.Request, user fnos.User, signed bool) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	status := http.StatusOK
	body := map[string]any{"ok": true, "status": "ok", "version": h.cfg.Version, "buildId": h.cfg.BuildID,
		"authenticated": signed, "mode": h.cfg.Auth.Mode(), "core": h.core()}
	if h.cfg.Auth.Mode() == fnos.Local {
		body["devUserHeader"] = fnos.DevUserHeader
	} else if signed {
		body["csrfHeader"], body["csrfToken"] = fnos.CSRFHeader, h.cfg.Auth.CSRFToken(user)
	}
	if err := h.cfg.Store.Health(ctx); err != nil {
		status = http.StatusServiceUnavailable
		body["ok"], body["status"] = false, "unhealthy"
	}
	writeJSON(w, r, status, body)
}

func (h *Handler) settings(w http.ResponseWriter, r *http.Request, user fnos.User) {
	if !allow(w, r, http.MethodGet, http.MethodHead, http.MethodPut) {
		return
	}
	if r.Method == http.MethodPut {
		var value map[string]json.RawMessage
		if err := readJSON(w, r, 64<<10, &value); err != nil || value == nil {
			if err == nil {
				err = store.ErrInvalid
			}
			h.fail(w, r, err)
			return
		}
		data, err := json.Marshal(value)
		if err == nil {
			err = h.cfg.Store.SetSettings(r.Context(), user, string(data))
		}
		if err != nil {
			h.fail(w, r, err)
			return
		}
		writeJSON(w, r, http.StatusOK, json.RawMessage(data))
		return
	}
	v, err := h.cfg.Store.Settings(r.Context(), user)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, r, http.StatusOK, json.RawMessage(v))
}

var errMediaType = errors.New("invalid content type")

func writeJSON(w http.ResponseWriter, r *http.Request, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_ = json.NewEncoder(w).Encode(value)
	}
}

func problem(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	writeJSON(w, r, status, map[string]string{"code": code, "message": message})
}

func allow(w http.ResponseWriter, r *http.Request, methods ...string) bool {
	for _, m := range methods {
		if r.Method == m {
			return true
		}
	}
	w.Header().Set("Allow", strings.Join(methods, ", "))
	problem(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "不支持此请求方式。")
	return false
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	var conflict *store.SaveConflict
	var tooLarge *http.MaxBytesError
	switch {
	case errors.As(err, &conflict):
		status, code := http.StatusPreconditionFailed, "save_changed"
		if conflict.Exists {
			status, code = http.StatusConflict, "slot_exists"
		}
		w.Header().Set("ETag", conflict.Current.ETag)
		writeJSON(w, r, status, map[string]any{"code": code, "message": "存档槽位已有其他版本，请刷新后重试。", "current": h.saveView(conflict.Current)})
	case errors.Is(err, store.ErrTooLarge), errors.As(err, &tooLarge):
		problem(w, r, http.StatusRequestEntityTooLarge, "file_too_large", "上传文件超过大小限制。")
	case errors.Is(err, errMediaType), errors.Is(err, library.ErrInvalidROM):
		problem(w, r, http.StatusUnsupportedMediaType, "unsupported_format", "请求类型或 NES 卡带格式无效。")
	case errors.Is(err, store.ErrInvalid), errors.Is(err, io.ErrUnexpectedEOF):
		problem(w, r, http.StatusBadRequest, "invalid_request", "请求字段无效，请检查后重试。")
	case errors.Is(err, store.ErrIncompatible):
		problem(w, r, http.StatusConflict, "incompatible_save", "模拟器核心版本、卡带或存档校验值不匹配。")
	case errors.Is(err, store.ErrReadOnly):
		problem(w, r, http.StatusForbidden, "read_only", "内置游戏不能修改或删除。")
	case errors.Is(err, store.ErrNotFound):
		problem(w, r, http.StatusNotFound, "not_found", "未找到所请求的内容。")
	case errors.Is(err, store.ErrCorrupt):
		problem(w, r, http.StatusInternalServerError, "data_unavailable", "数据文件缺失或校验失败。")
	default:
		problem(w, r, http.StatusInternalServerError, "internal_error", "操作未能完成，请稍后重试。")
	}
}

func (h *Handler) uploading(w http.ResponseWriter, r *http.Request) bool {
	select {
	case h.uploads <- struct{}{}:
		return true
	default:
		w.Header().Set("Retry-After", "1")
		problem(w, r, http.StatusServiceUnavailable, "upload_busy", "有其他文件正在上传，请稍后重试。")
		return false
	}
}
