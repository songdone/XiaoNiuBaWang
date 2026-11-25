// Package extensions connects NAS and backup routes after httpapi authentication
// and CSRF checks. It does not derive an identity from any HTTP header.
package extensions

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	"xiaoniubawang/internal/backup"
	"xiaoniubawang/internal/fnos"
	"xiaoniubawang/internal/library"
	"xiaoniubawang/internal/nas"
	"xiaoniubawang/internal/saves"
	"xiaoniubawang/internal/store"
)

type Config struct {
	Store   *store.Store
	Library *library.Service
	Auth    *fnos.Auth
}
type Handler struct {
	nas     *nas.Service
	scanner *nas.Scanner
	backup  *backup.Service
	heavy   chan struct{}
}

func New(c Config) *Handler {
	s := nas.New(nas.NewGateway(c.Auth), c.Library)
	return &Handler{nas: s, scanner: nas.NewScanner(s), backup: backup.New(c.Store, c.Library, saves.New(c.Store, c.Library)), heavy: make(chan struct{}, 1)}
}
func (h *Handler) Close() error { h.scanner.Close(); return nil }

func jsonResponse(w http.ResponseWriter, r *http.Request, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_ = json.NewEncoder(w).Encode(value)
	}
}
func problem(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	jsonResponse(w, r, status, map[string]any{"code": code, "message": message, "error": map[string]string{"code": code, "message": message}})
}
func allow(w http.ResponseWriter, r *http.Request, methods ...string) bool {
	for _, m := range methods {
		if r.Method == m {
			return true
		}
	}
	w.Header().Set("Allow", strings.Join(methods, ", "))
	problem(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "不支持此请求方式")
	return false
}
func readJSON(w http.ResponseWriter, r *http.Request, v any) error {
	t, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || t != "application/json" {
		return store.ErrInvalid
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err = d.Decode(v); err != nil {
		return store.ErrInvalid
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return store.ErrInvalid
	}
	return nil
}
func fail(w http.ResponseWriter, r *http.Request, err error) {
	var large *http.MaxBytesError
	switch {
	case errors.Is(err, nas.ErrUnavailable):
		problem(w, r, 503, "nas_unavailable", "NAS 目录仅在飞牛系统网关中可用，请通过飞牛桌面打开应用并授权目录")
	case errors.Is(err, nas.ErrDirectoryUnreadable):
		problem(w, r, 403, "nas_directory_unreadable", "已授权目录当前无法安全读取，请检查当前用户和应用的目录读取权限；不支持链接目录")
	case errors.Is(err, nas.ErrDenied):
		problem(w, r, 403, "access_denied", "此目录未获当前用户授权，或读取权限已撤销")
	case errors.Is(err, nas.ErrRefresh):
		problem(w, r, 410, "nas_refresh_required", "目录引用已失效，请刷新已授权目录后重试")
	case errors.Is(err, nas.ErrPath):
		problem(w, r, 400, "unsafe_path", "请选择已授权目录中的普通 NES 文件；不支持链接或特殊文件")
	case errors.Is(err, nas.ErrJobNotFound):
		problem(w, r, 404, "scan_not_found", "未找到此扫描任务")
	case errors.Is(err, nas.ErrBusy):
		problem(w, r, 409, "scan_busy", "已有扫描任务正在运行，请先等待完成或取消")
	case errors.Is(err, backup.ErrLimit), errors.Is(err, nas.ErrLimit), errors.Is(err, store.ErrTooLarge), errors.As(err, &large):
		problem(w, r, 413, "limit_exceeded", "文件大小、目录条目数或备份成员数超过限制")
	case errors.Is(err, backup.ErrInvalid):
		problem(w, r, 400, "invalid_backup", "备份格式、文件摘要或 ROM 与存档关联校验失败")
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		problem(w, r, 408, "cancelled", "操作已取消或超时；已完成的新增数据予以保留")
	case errors.Is(err, store.ErrInvalid), errors.Is(err, library.ErrInvalidROM):
		problem(w, r, 400, "invalid_request", "请求字段或 NES 文件格式不正确")
	case errors.Is(err, store.ErrNotFound):
		problem(w, r, 404, "not_found", "未找到当前用户的数据")
	default:
		problem(w, r, 500, "operation_failed", "操作未能完成，请重试")
	}
}

// Handle is called only AFTER the owning httpapi verifies identity, origin and
// mutations. Its path is already normalized and has the gateway prefix removed.
func (h *Handler) Handle(w http.ResponseWriter, r *http.Request, user fnos.User) bool {
	p := r.URL.Path
	if !strings.HasPrefix(p, "/api/nas/") && p != "/api/backup" && p != "/api/backup/restore" {
		return false
	}
	if user == "" {
		problem(w, r, 401, "authentication_required", "请先登录")
		return true
	}
	switch {
	case p == "/api/nas/roots":
		if !allow(w, r, "GET", "HEAD") {
			return true
		}
		result, err := h.nas.RootsDetailed(r.Context(), user)
		capabilities := map[string]bool{"browse": true, "importFiles": true, "scan": true}
		if err != nil {
			// Counts contain only this user's grants. Known rejected-directory
			// outcomes retain the available picker without exposing rejected paths.
			status, code, message := 0, "", ""
			switch {
			case errors.Is(err, nas.ErrDirectoryUnreadable):
				status, code, message = 403, "nas_directory_unreadable", "已授权目录当前无法安全读取，请检查当前用户和应用的目录读取权限；不支持链接目录"
			case errors.Is(err, nas.ErrDenied):
				status, code, message = 403, "access_denied", "当前用户的已授权目录均未通过读取权限检查，请重新确认权限"
			case errors.Is(err, nas.ErrPath):
				status, code, message = 400, "unsafe_path", "已授权目录路径无法安全使用，请重新选择普通目录"
			}
			if status == 0 || !result.Complete || result.Diagnostics.Authorized == 0 {
				fail(w, r, err)
				return true
			}
			jsonResponse(w, r, status, map[string]any{"available": true, "roots": []nas.Root{}, "capabilities": capabilities, "diagnostics": result.Diagnostics, "code": code, "message": message, "error": map[string]string{"code": code, "message": message}})
			return true
		}
		jsonResponse(w, r, 200, map[string]any{"available": true, "roots": result.Roots, "capabilities": capabilities, "diagnostics": result.Diagnostics})
	case p == "/api/nas/browse":
		if !allow(w, r, "GET", "HEAD") {
			return true
		}
		q, err := strictQuery(r, "path")
		if err != nil {
			fail(w, r, err)
			return true
		}
		out, err := h.nas.Browse(r.Context(), user, q)
		if err != nil {
			fail(w, r, err)
			return true
		}
		jsonResponse(w, r, 200, out)
	case p == "/api/nas/import":
		if !allow(w, r, "POST") {
			return true
		}
		var input struct {
			Paths []string `json:"paths"`
		}
		if err := readJSON(w, r, &input); err != nil {
			fail(w, r, err)
			return true
		}
		if !h.acquire(w, r) {
			return true
		}
		defer h.release()
		out, err := h.nas.Import(r.Context(), user, input.Paths)
		if err != nil {
			fail(w, r, err)
			return true
		}
		jsonResponse(w, r, 200, out)
	case p == "/api/nas/scan":
		if !allow(w, r, "POST") {
			return true
		}
		var input struct {
			Path string `json:"path"`
		}
		if err := readJSON(w, r, &input); err != nil {
			fail(w, r, err)
			return true
		}
		job, err := h.scanner.Start(r.Context(), user, input.Path)
		if err != nil {
			fail(w, r, err)
			return true
		}
		jsonResponse(w, r, 202, job)
	case strings.HasPrefix(p, "/api/nas/scan/"):
		if !allow(w, r, "GET", "HEAD", "DELETE") {
			return true
		}
		id := strings.TrimPrefix(p, "/api/nas/scan/")
		var job nas.Job
		var err error
		if r.Method == "DELETE" {
			job, err = h.scanner.Cancel(r.Context(), user, id)
		} else {
			job, err = h.scanner.Get(user, id)
		}
		if err != nil {
			fail(w, r, err)
			return true
		}
		jsonResponse(w, r, 200, job)
	case p == "/api/backup":
		if !allow(w, r, "GET", "HEAD") {
			return true
		}
		opts := backup.ExportOptions{IncludeROMs: true}
		filename := "xiaoniubawang-backup.zip"
		if r.URL.RawQuery != "" {
			mode, err := strictQuery(r, "mode")
			if err != nil || (mode != "full" && mode != "saves") {
				fail(w, r, store.ErrInvalid)
				return true
			}
			if mode == "saves" {
				opts.IncludeROMs = false
				filename = "xiaoniubawang-saves-backup.zip"
			}
		}
		if !h.acquire(w, r) {
			return true
		}
		defer h.release()
		f, size, err := h.backup.ExportToFile(r.Context(), user, opts)
		if err != nil {
			fail(w, r, err)
			return true
		}
		defer func() {
			name := f.Name()
			_ = f.Close()
			_ = os.Remove(name)
		}()
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
		w.Header().Set("Cache-Control", "private, no-store")
		if r.Method != "HEAD" {
			_, _ = io.Copy(w, f)
		}
	case p == "/api/backup/restore":
		if !allow(w, r, "POST") {
			return true
		}
		if !h.acquire(w, r) {
			return true
		}
		defer h.release()
		f, size, err := restoreUploadToFile(w, r)
		if err != nil {
			fail(w, r, err)
			return true
		}
		defer func() {
			name := f.Name()
			_ = f.Close()
			_ = os.Remove(name)
		}()
		out, err := h.backup.Restore(r.Context(), user, f, size)
		if err != nil {
			fail(w, r, err)
			return true
		}
		jsonResponse(w, r, 200, out)
	default:
		problem(w, r, 404, "not_found", "未找到此接口")
	}
	return true
}
func strictQuery(r *http.Request, key string) (string, error) {
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(q) != 1 || len(q[key]) != 1 || q.Get(key) == "" {
		return "", store.ErrInvalid
	}
	return q.Get(key), nil
}
func (h *Handler) acquire(w http.ResponseWriter, r *http.Request) bool {
	select {
	case h.heavy <- struct{}{}:
		return true
	default:
		problem(w, r, 429, "operation_busy", "正在导入或处理备份，请稍后重试")
		return false
	}
}
func (h *Handler) release() { <-h.heavy }

type requestReader struct {
	ctx context.Context
	r   io.Reader
}

func (r requestReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.r.Read(p)
}

func restoreUploadToFile(w http.ResponseWriter, r *http.Request) (*os.File, int64, error) {
	t, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || t != "multipart/form-data" || params["boundary"] == "" {
		return nil, 0, store.ErrInvalid
	}
	r.Body = http.MaxBytesReader(w, r.Body, backup.MaxArchiveBytes+(1<<20))
	mr := multipart.NewReader(r.Body, params["boundary"])
	var (
		file *os.File
		size int64
	)
	cleanup := func() {
		if file != nil {
			name := file.Name()
			_ = file.Close()
			_ = os.Remove(name)
			file = nil
		}
	}
	for i := 0; ; i++ {
		p, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			cleanup()
			var large *http.MaxBytesError
			if errors.As(err, &large) {
				return nil, 0, backup.ErrLimit
			}
			return nil, 0, store.ErrInvalid
		}
		if i != 0 || p.FormName() != "file" || p.FileName() == "" {
			p.Close()
			cleanup()
			return nil, 0, store.ErrInvalid
		}
		file, err = os.CreateTemp("", "xnbw-restore-*.zip")
		if err != nil {
			p.Close()
			return nil, 0, err
		}
		if err = file.Chmod(0600); err != nil {
			p.Close()
			cleanup()
			return nil, 0, err
		}
		n, err := io.Copy(file, io.LimitReader(requestReader{ctx: r.Context(), r: p}, backup.MaxArchiveBytes+1))
		p.Close()
		if err != nil {
			cleanup()
			return nil, 0, err
		}
		if n > backup.MaxArchiveBytes {
			cleanup()
			return nil, 0, backup.ErrLimit
		}
		size = n
	}
	if file == nil || size == 0 {
		cleanup()
		return nil, 0, store.ErrInvalid
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		cleanup()
		return nil, 0, err
	}
	return file, size, nil
}
