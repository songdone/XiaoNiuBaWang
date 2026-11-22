// Package nas provides fail-closed fnOS authorization and read-only ROM discovery.
package nas

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"xiaoniubawang/internal/fnos"
)

var (
	ErrUnavailable         = errors.New("NAS 访问需要飞牛 Unix 网关授权服务")
	ErrDirectoryUnreadable = errors.New("已授权目录当前无法安全读取，请检查用户及应用目录权限")
	ErrDenied              = errors.New("此路径当前未获用户授权或读取权限")
	ErrPath                = errors.New("NAS 目录引用无效或不安全")
	ErrLimit               = errors.New("NAS 操作超过限制")
)

const gatewaySocket = "/var/run/trim_open_gateway_apiscope.socket"

// Authorizer is injected only by trusted server construction, never request headers.
type Authorizer interface {
	Roots(context.Context, fnos.User) ([]string, error)
	Readable(context.Context, fnos.User, string) (bool, error)
}

type Gateway struct {
	client  *http.Client
	token   string
	appName string
	enabled bool
}

// NewGateway never enables NAS access for local-development identities. The token
// remains in the backend process and is used only on the fixed Unix socket.
func NewGateway(auth *fnos.Auth) *Gateway {
	g := &Gateway{appName: "xiaoniubawang"}
	if auth == nil || auth.Mode() != fnos.Gateway {
		return g
	}
	g.token = os.Getenv("TRIM_API_TOKEN")
	g.enabled = g.token != ""
	g.client = &http.Client{Timeout: 15 * time.Second, Transport: &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "unix", gatewaySocket)
		},
		MaxConnsPerHost: 8,
	}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return g
}

func gatewayUID(user fnos.User) (int64, error) {
	s, ok := strings.CutPrefix(string(user), "uid-")
	if !ok || s == "" || s[0] == '0' {
		return 0, ErrUnavailable
	}
	id, err := strconv.ParseInt(s, 10, 64)
	if err != nil || id <= 0 || strconv.FormatInt(id, 10) != s {
		return 0, ErrUnavailable
	}
	return id, nil
}

func (g *Gateway) call(ctx context.Context, req string, data any, result any) error {
	if g == nil || !g.enabled || g.client == nil {
		return ErrUnavailable
	}
	body, err := json.Marshal(struct {
		Req     string `json:"req"`
		AppName string `json:"appName"`
		Data    any    `json:"data"`
	}{req, g.appName, data})
	if err != nil {
		return ErrUnavailable
	}
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://fnos-gateway/api/v1/trimapp", bytes.NewReader(body))
	if err != nil {
		return ErrUnavailable
	}
	r.Header.Set("Authorization", "Bearer "+g.token)
	r.Header.Set("Content-Type", "application/json")
	response, err := g.client.Do(r)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return ErrUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return ErrUnavailable
	}
	b, err := io.ReadAll(io.LimitReader(response.Body, 1<<20+1))
	if err != nil || len(b) > 1<<20 {
		return ErrUnavailable
	}
	var envelope struct {
		Code *int            `json:"code"`
		Data json.RawMessage `json:"data"`
	}
	if json.Unmarshal(b, &envelope) != nil || envelope.Code == nil || *envelope.Code != 0 || len(envelope.Data) == 0 {
		return ErrUnavailable
	}
	if json.Unmarshal(envelope.Data, result) != nil {
		return ErrUnavailable
	}
	return nil
}

// Roots uses only userAccess; app-wide sharedAccess does not grant a user access.
// Official contracts: /api/authorization/user-access/ and /file-acl/.
func (g *Gateway) Roots(ctx context.Context, user fnos.User) ([]string, error) {
	uid, err := gatewayUID(user)
	if err != nil {
		return nil, err
	}
	var out struct {
		Paths json.RawMessage `json:"paths"`
	}
	if err = g.call(ctx, "trim.file.getUserAccessibleFolders", map[string]any{"uid": uid}, &out); err != nil {
		return nil, err
	}
	// An explicit empty array means no grants; missing/null fields are not that
	// contract. Inspect each item because encoding/json accepts null as a string's
	// zero value, which could otherwise turn malformed grants into an empty UI.
	raw := bytes.TrimSpace(out.Paths)
	if len(raw) == 0 || raw[0] != '[' {
		return nil, ErrUnavailable
	}
	var items []json.RawMessage
	if json.Unmarshal(raw, &items) != nil {
		return nil, ErrUnavailable
	}
	if len(items) > 1024 {
		return nil, ErrLimit
	}
	paths := make([]string, 0, len(items))
	for _, item := range items {
		item = bytes.TrimSpace(item)
		var path string
		if len(item) == 0 || item[0] != '"' || json.Unmarshal(item, &path) != nil {
			return nil, ErrUnavailable
		}
		paths = append(paths, path)
	}
	return paths, nil
}

func (g *Gateway) Readable(ctx context.Context, user fnos.User, path string) (bool, error) {
	uid, err := gatewayUID(user)
	if err != nil {
		return false, err
	}
	var out []struct {
		Path     string `json:"path"`
		Readable *bool  `json:"readable"`
	}
	if err = g.call(ctx, "trim.file.checkUserACL", map[string]any{"uid": uid, "path": path}, &out); err != nil {
		return false, err
	}
	if len(out) != 1 || out[0].Path != path {
		return false, fmt.Errorf("%w: 权限检查响应不完整", ErrDenied)
	}
	if out[0].Readable == nil {
		return false, ErrUnavailable
	}
	return *out[0].Readable, nil
}
