package nas

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"xiaoniubawang/internal/fnos"
)

var ErrRefresh = errors.New("目录引用已失效，请刷新已授权目录")

const handleTTL = 20 * time.Minute
const maxHandles = 65536
const maxUserHandles = 20000

type pathHandle struct {
	owner   fnos.User
	path    string
	expires time.Time
}

func validHandle(v string) bool {
	if !strings.HasPrefix(v, "nas_") || len(v) != 68 {
		return false
	}
	_, err := hex.DecodeString(v[4:])
	return err == nil
}
func (s *Service) handle(user fnos.User, p string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	count := 0
	for key, h := range s.handles {
		if !h.expires.After(now) {
			delete(s.handles, key)
			continue
		}
		if h.owner == user {
			count++
			if h.path == p {
				return key, nil
			}
		}
	}
	if len(s.handles) >= maxHandles || count >= maxUserHandles {
		return "", ErrLimit
	}
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		return "", ErrUnavailable
	}
	key := "nas_" + hex.EncodeToString(token[:])
	s.handles[key] = pathHandle{owner: user, path: p, expires: now.Add(handleTTL)}
	return key, nil
}
func (s *Service) resolve(user fnos.User, key string) (string, error) {
	if !validHandle(key) {
		return "", ErrPath
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	h, ok := s.handles[key]
	if !ok || h.owner != user {
		return "", ErrRefresh
	}
	if !h.expires.After(time.Now()) {
		delete(s.handles, key)
		return "", ErrRefresh
	}
	return h.path, nil
}
func displayPath(p string) string {
	if validHandle(p) {
		return p
	}
	p = filepath.Base(strings.ReplaceAll(p, "\\", "/"))
	p = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, p)
	if p == "." || p == "/" || p == ".." || len(p) > 255 {
		return ""
	}
	return p
}
