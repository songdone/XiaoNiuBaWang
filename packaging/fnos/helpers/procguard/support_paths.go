//go:build linux || darwin

package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"xiaoniubawang/internal/fnos"
)

type supportVerificationError struct {
	code string
	err  error
}

func (e *supportVerificationError) Error() string { return e.code }
func (e *supportVerificationError) Unwrap() error { return e.err }

func supportFailure(code string, err error) error {
	return &supportVerificationError{code: code, err: err}
}

// Only fixed codes leave the helper; underlying errors may contain private paths.
func supportErrorCode(err error) string {
	var failure *supportVerificationError
	if errors.As(err, &failure) {
		switch failure.code {
		case "support_ancestor_unreadable", "unsafe_path", "approved_asset_mismatch", "support_acl_unreadable":
			return failure.code
		}
	}
	return "unsafe_path"
}

// resolveSupportAlias accepts only the platform-configured application path.
// Every traversed directory must have trusted effective writers, and symlinks
// themselves must belong to root or the package UID. The caller subsequently
// opens the canonical result nofollow and repeats resolution before activation.
func resolveSupportAlias(path string, uid uint32, readACL func(string) ([]byte, error)) (string, error) {
	if !filepath.IsAbs(path) || path == "/" || strings.ContainsAny(path, "\r\n") {
		return "", errors.New("invalid platform support path")
	}
	path = filepath.Clean(path)
	for links := 0; links <= 40; links++ {
		current := "/"
		parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
		restarted := false
		for index := -1; index < len(parts); index++ {
			if index >= 0 {
				current = filepath.Join(current, parts[index])
			}
			before, err := os.Lstat(current)
			if err != nil {
				if errors.Is(err, os.ErrPermission) {
					return "", supportFailure("support_ancestor_unreadable", err)
				}
				return "", supportFailure("unsafe_path", err)
			}
			stat, ok := before.Sys().(*syscall.Stat_t)
			if !ok || stat.Uid != 0 && stat.Uid != uid {
				return "", errors.New("untrusted platform support path owner")
			}
			if before.Mode()&os.ModeSymlink != 0 {
				target, err := os.Readlink(current)
				after, statErr := os.Lstat(current)
				if err != nil || statErr != nil || !os.SameFile(before, after) || before.ModTime() != after.ModTime() || before.Size() != after.Size() {
					return "", errors.New("platform support alias changed")
				}
				if strings.ContainsAny(target, "\r\n") {
					return "", errors.New("unsafe platform support alias")
				}
				if !filepath.IsAbs(target) {
					target = filepath.Join(filepath.Dir(current), target)
				}
				path = filepath.Join(append([]string{target}, parts[index+1:]...)...)
				restarted = true
				break
			}
			var aclErr error
			if !before.IsDir() || !fnos.PackageAssetWriteSafe(before.Mode(), stat.Uid, uid, func() ([]byte, error) {
				var acl []byte
				acl, aclErr = readACL(current)
				return acl, aclErr
			}) {
				if aclErr != nil {
					return "", aclErr
				}
				return "", supportFailure("unsafe_path", errors.New("unsafe effective writer on platform support path"))
			}
		}
		if !restarted {
			return path, nil
		}
	}
	return "", errors.New("too many platform support aliases")
}
