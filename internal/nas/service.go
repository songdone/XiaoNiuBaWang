package nas

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"unicode"
	"unicode/utf8"

	"golang.org/x/sys/unix"

	"xiaoniubawang/internal/fnos"
	"xiaoniubawang/internal/library"
	"xiaoniubawang/internal/store"
)

const MaxROMSize int64 = library.MaxROMSize
const MaxEntries = 4096

type Importer interface {
	Import(context.Context, fnos.User, []library.Upload) ([]store.Game, error)
}

type Root struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

// RootDiagnostics contains only counts of the current user's platform grants.
// Rejected paths and names never leave the backend, including on error responses.
type RootDiagnostics struct {
	Authorized          int `json:"authorized"`
	Usable              int `json:"usable"`
	InvalidPath         int `json:"invalidPath"`
	ACLDenied           int `json:"aclDenied"`
	DirectoryUnreadable int `json:"directoryUnreadable"`
	Duplicate           int `json:"duplicate"`
}

type RootResult struct {
	Roots       []Root          `json:"roots"`
	Diagnostics RootDiagnostics `json:"diagnostics"`
	// Complete is false on interruption or gateway failure; HTTP handlers must
	// never present partially collected rejection counts as a finished result.
	Complete bool `json:"-"`
}

type Entry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Kind string `json:"kind"`
	Size int64  `json:"size,omitempty"`
}
type Listing struct {
	Path      string  `json:"path"`
	Parent    *string `json:"parent"`
	Root      string  `json:"root"`
	Entries   []Entry `json:"entries"`
	Truncated bool    `json:"truncated"`
}
type Issue struct {
	Path    string `json:"path"`
	Code    string `json:"code"`
	Message string `json:"message"`
}
type ImportResult struct {
	Games    []store.Game `json:"games"`
	Imported int          `json:"imported"`
	Failed   []Issue      `json:"failed"`
}

type Service struct {
	auth    Authorizer
	library Importer
	mu      sync.Mutex
	handles map[string]pathHandle
}

func New(auth Authorizer, library Importer) *Service {
	return &Service{auth: auth, library: library, handles: map[string]pathHandle{}}
}

func validPath(p string) bool {
	if p == "" || p == "/" || len(p) > 4096 || !utf8.ValidString(p) || !filepath.IsAbs(p) || filepath.Clean(p) != p || strings.ContainsAny(p, "\\\x00") || strings.ContainsFunc(p, unicode.IsControl) {
		return false
	}
	for _, c := range strings.Split(p, "/")[1:] {
		if c == "" || c == "." || c == ".." {
			return false
		}
	}
	return true
}

func within(root, p string) bool { return p == root || strings.HasPrefix(p, root+"/") }

// pinDir uses actual openat O_NOFOLLOW for every component. os.Root.OpenFile
// follows in-root symlinks, so it cannot enforce this stricter no-links policy.
func pinDir(p string) (*os.File, error) {
	if !validPath(p) {
		return nil, ErrPath
	}
	fd, err := unix.Open("/", intermediateDirFlags(), 0)
	if err != nil {
		return nil, ErrPath
	}
	components := strings.Split(p, "/")[1:]
	for i, component := range components {
		flags := intermediateDirFlags()
		if i == len(components)-1 {
			// Only the selected directory must be readable/listable. Ancestors
			// require traversal permission, not permission to enumerate siblings.
			flags = unix.O_RDONLY | unix.O_NOFOLLOW | unix.O_NONBLOCK | unix.O_DIRECTORY | unix.O_CLOEXEC
		}
		next, e := unix.Openat(fd, component, flags, 0)
		unix.Close(fd)
		if e != nil {
			return nil, ErrPath
		}
		// Linux O_PATH|O_NOFOLLOW can pin a symlink on its own. O_DIRECTORY
		// plus this descriptor check ensures it can never become an ancestor.
		var st unix.Stat_t
		if e = unix.Fstat(next, &st); e != nil || st.Mode&unix.S_IFMT != unix.S_IFDIR {
			unix.Close(next)
			return nil, ErrPath
		}
		fd = next
	}
	return os.NewFile(uintptr(fd), p), nil
}

func lstatAt(dir *os.File, name string) (*unix.Stat_t, error) {
	var st unix.Stat_t
	err := unix.Fstatat(int(dir.Fd()), name, &st, unix.AT_SYMLINK_NOFOLLOW)
	return &st, err
}

func (s *Service) authorized(ctx context.Context, user fnos.User, p string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if !validPath(p) {
		return "", ErrPath
	}
	if s == nil || s.auth == nil {
		return "", ErrUnavailable
	}
	roots, err := s.auth.Roots(ctx, user)
	if err != nil {
		return "", err
	}
	var selected string
	for _, root := range roots {
		if validPath(root) && within(root, p) && len(root) > len(selected) {
			selected = root
		}
	}
	if selected == "" {
		return "", ErrDenied
	}
	ok, err := s.auth.Readable(ctx, user, p)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", ErrDenied
	}
	return selected, nil
}

func (s *Service) Roots(ctx context.Context, user fnos.User) ([]Root, error) {
	result, err := s.RootsDetailed(ctx, user)
	return result.Roots, err
}

func (s *Service) RootsDetailed(ctx context.Context, user fnos.User) (RootResult, error) {
	out := RootResult{Roots: []Root{}}
	if err := ctx.Err(); err != nil {
		return out, err
	}
	if s == nil || s.auth == nil {
		return out, ErrUnavailable
	}
	paths, err := s.auth.Roots(ctx, user)
	if err != nil {
		return out, err
	}
	out.Diagnostics.Authorized = len(paths)
	seen := map[string]bool{}
	for _, p := range paths {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		if !validPath(p) {
			out.Diagnostics.InvalidPath++
			continue
		}
		if seen[p] {
			out.Diagnostics.Duplicate++
			continue
		}
		seen[p] = true
		ok, e := s.auth.Readable(ctx, user, p)
		if e != nil {
			return out, e
		}
		if !ok {
			out.Diagnostics.ACLDenied++
			continue
		}
		r, e := pinDir(p)
		if e != nil {
			out.Diagnostics.DirectoryUnreadable++
			continue
		}
		r.Close()
		key, e := s.handle(user, p)
		if e != nil {
			return out, e
		}
		out.Roots = append(out.Roots, Root{key, filepath.Base(p), "directory"})
		out.Diagnostics.Usable++
	}
	sort.Slice(out.Roots, func(i, j int) bool { return out.Roots[i].Name < out.Roots[j].Name })
	out.Complete = true
	if len(paths) != 0 && len(out.Roots) == 0 {
		switch {
		case out.Diagnostics.DirectoryUnreadable != 0:
			return out, ErrDirectoryUnreadable
		case out.Diagnostics.ACLDenied != 0:
			return out, ErrDenied
		default:
			return out, ErrPath
		}
	}
	return out, nil
}

// Browse accepts only owner-scoped opaque references from Roots/Browse.
func (s *Service) Browse(ctx context.Context, user fnos.User, key string) (Listing, error) {
	p, err := s.resolve(user, key)
	if err != nil {
		return Listing{}, err
	}
	out, err := s.browsePath(ctx, user, p)
	if err != nil {
		return Listing{}, err
	}
	out.Path, err = s.handle(user, out.Path)
	if err != nil {
		return Listing{}, err
	}
	out.Root, err = s.handle(user, out.Root)
	if err != nil {
		return Listing{}, err
	}
	if out.Parent != nil {
		parent, e := s.handle(user, *out.Parent)
		if e != nil {
			return Listing{}, e
		}
		out.Parent = &parent
	}
	for i := range out.Entries {
		out.Entries[i].Path, err = s.handle(user, out.Entries[i].Path)
		if err != nil {
			return Listing{}, err
		}
	}
	return out, nil
}

func (s *Service) browsePath(ctx context.Context, user fnos.User, p string) (Listing, error) {
	selected, err := s.authorized(ctx, user, p)
	if err != nil {
		return Listing{}, err
	}
	f, err := pinDir(p)
	if err != nil {
		return Listing{}, err
	}
	defer f.Close()
	out := Listing{Path: p, Root: selected, Entries: []Entry{}}
	if p != selected {
		parent := filepath.Dir(p)
		out.Parent = &parent
	}
	// Bound all entries inspected, including hidden/unsupported files.
	names, err := f.Readdirnames(MaxEntries + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return Listing{}, err
	}
	if len(names) > MaxEntries {
		names = names[:MaxEntries]
		out.Truncated = true
	}
	for _, name := range names {
		if err := ctx.Err(); err != nil {
			return Listing{}, err
		}
		full := filepath.Join(p, name)
		if !validPath(full) {
			continue
		}
		info, e := lstatAt(f, name)
		if e != nil {
			continue
		}
		kind := "directory"
		if info.Mode&unix.S_IFMT != unix.S_IFDIR {
			if info.Mode&unix.S_IFMT != unix.S_IFREG || info.Nlink != 1 || !strings.EqualFold(filepath.Ext(name), ".nes") {
				continue
			}
			kind = "rom"
		}
		ok, e := s.auth.Readable(ctx, user, full)
		if e != nil {
			return Listing{}, e
		}
		if !ok {
			continue
		}
		out.Entries = append(out.Entries, Entry{Name: name, Path: full, Kind: kind, Size: info.Size})
	}
	// Do not return names after authorization was revoked during enumeration.
	if _, err = s.authorized(ctx, user, p); err != nil {
		return Listing{}, err
	}
	sort.Slice(out.Entries, func(i, j int) bool {
		a, b := out.Entries[i], out.Entries[j]
		if a.Kind != b.Kind {
			return a.Kind == "directory"
		}
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})
	return out, nil
}

func regular(info os.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return info.Mode().IsRegular() && ok && stat.Nlink == 1
}

func (s *Service) openROM(ctx context.Context, user fnos.User, p string) (*os.File, error) {
	if !strings.EqualFold(filepath.Ext(p), ".nes") {
		return nil, ErrPath
	}
	if _, err := s.authorized(ctx, user, p); err != nil {
		return nil, err
	}
	r, err := pinDir(filepath.Dir(p))
	if err != nil {
		return nil, err
	}
	defer r.Close()
	fd, err := unix.Openat(int(r.Fd()), filepath.Base(p), unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, ErrPath
	}
	f := os.NewFile(uintptr(fd), p)
	info, err := f.Stat()
	if err != nil || !regular(info) {
		f.Close()
		return nil, ErrPath
	}
	if info.Size() <= 0 || info.Size() > MaxROMSize {
		f.Close()
		return nil, ErrLimit
	}
	if _, err = s.authorized(ctx, user, p); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}

type contextReader struct {
	ctx       context.Context
	r         io.Reader
	remaining int64
}

func (r *contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	if r.remaining <= 0 {
		return 0, ErrLimit
	}
	if int64(len(p)) > r.remaining {
		p = p[:r.remaining]
	}
	n, err := r.r.Read(p)
	r.remaining -= int64(n)
	return n, err
}

func (s *Service) importOne(ctx context.Context, user fnos.User, p string) ([]store.Game, error) {
	if s.library == nil {
		return nil, ErrUnavailable
	}
	f, err := s.openROM(ctx, user, p)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return s.library.Import(ctx, user, []library.Upload{{Filename: filepath.Base(p), Reader: &contextReader{ctx: ctx, r: f, remaining: MaxROMSize + 1}}})
}

func issue(path string, err error) Issue {
	out := Issue{Path: displayPath(path), Code: "import_failed", Message: "ROM 导入失败"}
	switch {
	case errors.Is(err, ErrDenied):
		out.Code = "access_denied"
		out.Message = "目录授权或读取权限已撤销"
	case errors.Is(err, ErrUnavailable):
		out.Code = "nas_unavailable"
		out.Message = "飞牛 NAS 授权服务暂不可用"
	case errors.Is(err, ErrRefresh):
		out.Code = "nas_refresh_required"
		out.Message = "目录引用已失效，请刷新已授权目录"
	case errors.Is(err, ErrPath):
		out.Code = "unsafe_path"
		out.Message = "请选择已授权目录中的普通 NES 文件，不支持链接或特殊文件"
	case errors.Is(err, ErrLimit):
		out.Code = "limit_exceeded"
		out.Message = "NAS 操作超过大小或数量限制"
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		out.Code = "cancelled"
		out.Message = "操作已取消或超时"
	}
	return out
}

func (s *Service) Import(ctx context.Context, user fnos.User, paths []string) (ImportResult, error) {
	out := ImportResult{Games: []store.Game{}, Failed: []Issue{}}
	if len(paths) == 0 || len(paths) > 128 {
		return out, ErrLimit
	}
	seen := map[string]bool{}
	for _, p := range paths {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		if seen[p] {
			continue
		}
		seen[p] = true
		physical, err := s.resolve(user, p)
		var games []store.Game
		if err == nil {
			games, err = s.importOne(ctx, user, physical)
		}
		if err != nil {
			if ctx.Err() != nil {
				return out, ctx.Err()
			}
			out.Failed = append(out.Failed, issue(p, err))
			continue
		}
		out.Games = append(out.Games, games...)
		out.Imported += len(games)
	}
	return out, nil
}
