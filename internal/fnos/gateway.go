// Package fnos binds app identity to the selected HTTP transport.
package fnos

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

const (
	GatewayUIDHeader = "X-Trim-Userid"
	DevUserHeader    = "X-XNBW-Test-User"
	CSRFHeader       = "X-XNBW-CSRF"
	GatewayPrefix    = "/app/xiaoniubawang"
)

type Mode string

const (
	Gateway Mode = "gateway"
	Local   Mode = "local"
)

// User is an opaque data namespace. Real UIDs and developer identities never overlap.
type User string

type transportKey struct{}

// ConnContext records the actual connection transport, not a header or RemoteAddr.
func ConnContext(ctx context.Context, conn net.Conn) context.Context {
	var mode Mode
	switch c := conn.(type) {
	case *net.UnixConn:
		mode = Gateway
	case *net.TCPConn:
		local, lok := c.LocalAddr().(*net.TCPAddr)
		peer, pok := c.RemoteAddr().(*net.TCPAddr)
		if lok && pok && local.IP.IsLoopback() && peer.IP.IsLoopback() {
			mode = Local
		}
	}
	return context.WithValue(ctx, transportKey{}, mode)
}

type Auth struct {
	mode    Mode
	devHash [sha256.Size]byte
	secret  [32]byte
}

func NewAuth(mode Mode, marker string) (*Auth, error) {
	a := &Auth{mode: mode}
	switch mode {
	case Gateway:
		if marker != "" {
			return nil, errors.New("developer identity is not available on the gateway")
		}
	case Local:
		if marker == "" || len(marker) > 128 || strings.IndexFunc(marker, func(r rune) bool {
			return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_')
		}) >= 0 {
			return nil, errors.New("--dev-user requires a nonempty test marker (letters, digits, hyphen, underscore)")
		}
		a.devHash = sha256.Sum256([]byte(marker))
	default:
		return nil, errors.New("invalid auth mode")
	}
	rand.Read(a.secret[:])
	return a, nil
}

func (a *Auth) Mode() Mode { return a.mode }

func (a *Auth) Identify(r *http.Request) (User, bool) {
	if r.Context().Value(transportKey{}) != a.mode {
		return "", false
	}
	switch a.mode {
	case Gateway:
		v := r.Header.Values(GatewayUIDHeader)
		if len(v) != 1 || len(v[0]) == 0 || len(v[0]) > 19 || strings.IndexFunc(v[0], func(r rune) bool {
			return r < '0' || r > '9'
		}) >= 0 {
			return "", false
		}
		id, err := strconv.ParseInt(v[0], 10, 64)
		if err != nil || id <= 0 {
			return "", false
		}
		return User("uid-" + strconv.FormatInt(id, 10)), true
	case Local:
		v := r.Header.Values(DevUserHeader)
		if len(v) != 1 || len(v[0]) > 128 {
			return "", false
		}
		digest := sha256.Sum256([]byte(v[0]))
		if !hmac.Equal(digest[:], a.devHash[:]) {
			return "", false
		}
		return User("dev-" + hex.EncodeToString(digest[:])), true
	}
	return "", false
}

func (a *Auth) CSRFToken(user User) string {
	mac := hmac.New(sha256.New, a.secret[:])
	_, _ = mac.Write([]byte(user))
	return hex.EncodeToString(mac.Sum(nil))
}

func (a *Auth) ValidMutation(r *http.Request, user User) bool {
	if a.mode == Local {
		// The non-simple test user header already prevents cross-origin form writes.
		return true
	}
	v := r.Header.Values(CSRFHeader)
	return len(v) == 1 && hmac.Equal([]byte(v[0]), []byte(a.CSRFToken(user)))
}

// ValidHost rejects public Hostnames on developer TCP, including DNS rebinding.
func (a *Auth) ValidHost(r *http.Request) bool {
	if a.mode != Local {
		return true
	}
	host, _, ok := authority(r.Host)
	return ok && isLoopbackHost(host)
}

// SameOrigin supplies a browser boundary in addition to transport auth and CSRF.
// fnOS may terminate TLS or sit behind a reverse proxy with port translation.
func (a *Auth) SameOrigin(r *http.Request) bool {
	site := r.Header.Values("Sec-Fetch-Site")
	if len(site) > 1 || len(site) == 1 && site[0] != "same-origin" && site[0] != "none" {
		return false
	}
	origins := r.Header.Values("Origin")
	if len(origins) == 0 {
		return true
	}
	if len(origins) != 1 || strings.ContainsAny(origins[0], "?#") {
		return false
	}
	o, err := url.Parse(origins[0])
	if err != nil || o.User != nil || o.Path != "" || o.Host == "" || o.Scheme != "http" && o.Scheme != "https" {
		return false
	}
	incomingHost, incomingPort, valid := authority(o.Host)
	if !valid {
		return false
	}
	host, port, ok := authority(r.Host)
	if a.mode != Gateway {
		return ok && strings.EqualFold(host, incomingHost) && o.Scheme == "http" && defaultPort("http", port) == defaultPort("http", incomingPort)
	}
	if ok && strings.EqualFold(host, incomingHost) {
		if port == "" || port == defaultPort(o.Scheme, incomingPort) {
			return true
		}
		// Reverse-proxied fnOS access (e.g. external :443/:8443 -> internal :5666)
		// with matching hostname and browser-verified Sec-Fetch-Site: same-origin.
		if len(site) == 1 && site[0] == "same-origin" {
			return true
		}
	}
	// Accept exact host match against a single valid X-Forwarded-Host header
	// forwarded over fnOS's private Unix gateway socket.
	if fwd := r.Header.Values("X-Forwarded-Host"); len(fwd) == 1 {
		fHost, fPort, fOK := authority(strings.TrimSpace(fwd[0]))
		if fOK && strings.EqualFold(fHost, incomingHost) && (fPort == "" || defaultPort(o.Scheme, fPort) == defaultPort(o.Scheme, incomingPort)) {
			return true
		}
	}
	return false
}

func defaultPort(scheme, port string) string {
	if port != "" {
		return port
	}
	if scheme == "https" {
		return "443"
	}
	return "80"
}

func authority(s string) (string, string, bool) {
	if s == "" || strings.ContainsAny(s, " /\\#?@,%\t\r\n") {
		return "", "", false
	}
	host, port, err := net.SplitHostPort(s)
	if err != nil {
		if strings.HasPrefix(s, "[") && strings.HasSuffix(s, "]") && net.ParseIP(s[1:len(s)-1]) != nil {
			return s[1 : len(s)-1], "", true
		}
		return s, "", !strings.ContainsAny(s, ":[]")
	}
	value, err := strconv.ParseUint(port, 10, 16)
	return host, strconv.FormatUint(value, 10), err == nil && value != 0 && host != ""
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	return net.ParseIP(host).IsLoopback()
}

func ListenLocal(address string) (net.Listener, error) {
	host, port, err := net.SplitHostPort(address)
	_, portErr := strconv.ParseUint(port, 10, 16)
	if err != nil || portErr != nil || !isLoopbackHost(host) {
		return nil, errors.New("--listen requires an explicit loopback address and numeric port")
	}
	if strings.EqualFold(host, "localhost") {
		host = "127.0.0.1"
	}
	return net.Listen("tcp", net.JoinHostPort(host, port))
}

// ListenGateway requires a private socket in a package-controlled directory.
// Bind at 0600, refuse an occupied path, and only remove this listener's socket.
// The given path and its parent are operator configuration, not HTTP input.
func ListenGateway(socket string) (net.Listener, func(), error) {
	if !filepath.IsAbs(socket) || filepath.Clean(socket) != socket || socket == "/" {
		return nil, nil, errors.New("--socket requires a clean absolute socket path")
	}
	parent, err := os.Stat(filepath.Dir(socket))
	if err != nil {
		return nil, nil, fmt.Errorf("inspect socket directory: %w", err)
	}
	owner := parent.Sys().(*syscall.Stat_t).Uid
	if !gatewayDirectorySafe(parent.Mode(), owner, uint32(os.Geteuid()), func() ([]byte, error) {
		return gatewayAccessACL(filepath.Dir(socket))
	}) {
		return nil, nil, errors.New("gateway socket directory must not be writable by other users")
	}
	// Unix bind will fail with EADDRINUSE for existing entries. umask is set
	// once at server startup before accepting requests or doing other I/O.
	mask := syscall.Umask(0177)
	ln, err := net.ListenUnix("unix", &net.UnixAddr{Name: socket, Net: "unix"})
	syscall.Umask(mask)
	if err != nil {
		return nil, nil, fmt.Errorf("bind gateway socket: %w", err)
	}
	bound, err := os.Lstat(socket)
	if err != nil || bound.Mode()&os.ModeType != os.ModeSocket || bound.Mode().Perm() != 0600 {
		_ = ln.Close()
		return nil, nil, errors.New("could not verify private gateway socket")
	}
	ln.SetUnlinkOnClose(false)
	return ln, func() {
		_ = ln.Close()
		if info, err := os.Lstat(socket); err == nil && os.SameFile(bound, info) {
			_ = os.Remove(socket)
		}
	}, nil
}
