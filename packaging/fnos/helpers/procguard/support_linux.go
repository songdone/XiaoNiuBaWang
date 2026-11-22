//go:build linux

// SPDX-License-Identifier: GPL-3.0-or-later
package main

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/unix"
	"xiaoniubawang/internal/fnos"
)

type supportOriginal struct {
	name string
	size int64
	hash string
}

var approvedSupport = [...]supportOriginal{
	{"wechat-6uos.jpg", 62806, "33c845f8464cba9ab14cc923046865de45ddbdc81a6e0f088aaa90bc6719fc94"},
	{"alipay-6uos.jpg", 108962, "1a1a554d645d73467a802f631e415baaa45e1342e5762de75020981e6eadfdc7"},
}

var disabledSupport = supportOriginal{"support-disabled.flag", 27, "bee1de6ab8a7b2a3fdafdae876f00b61e6efcecb4d5b6be16180b97b6a0e4882"}

func supportPathACL(path string) ([]byte, error) {
	fd, err := unix.Open(path, unix.O_PATH|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	defer unix.Close(fd)
	return supportACL(fd)
}

func verifyPlatformSupport(path string, uid uint32) (string, bool, error) {
	canonical, err := resolveSupportAlias(path, uid, supportPathACL)
	if err != nil {
		return "", false, err
	}
	enabled, err := verifyInstalledSupport(canonical, uid)
	if err != nil {
		return "", false, err
	}
	after, err := resolveSupportAlias(path, uid, supportPathACL)
	if err != nil || canonical != after {
		return "", false, errors.New("platform support alias changed during verification")
	}
	return canonical, enabled, nil
}

func supportACL(fd int) ([]byte, error) {
	const attr = "system.posix_acl_access"
	read := func(data []byte) (int, error) {
		n, err := unix.Fgetxattr(fd, attr, data)
		if errors.Is(err, unix.EBADF) {
			// O_PATH does not support fgetxattr. This procfd magic link refers to
			// the still-open pinned inode, never to an unverified pathname.
			return unix.Getxattr(fmt.Sprintf("/proc/self/fd/%d", fd), attr, data)
		}
		return n, err
	}
	size, err := read(nil)
	if err != nil {
		return nil, supportFailure("support_acl_unreadable", err)
	}
	if size <= 0 || size > 65536 {
		return nil, supportFailure("unsafe_path", errors.New("invalid support ACL size"))
	}
	data := make([]byte, size)
	n, err := read(data)
	if err != nil || n != size {
		return nil, supportFailure("support_acl_unreadable", errors.New("support ACL changed or cannot be read"))
	}
	return data, nil
}

func safeSupportNode(file *os.File, uid uint32, directory bool) (unix.Stat_t, error) {
	var snapshot unix.Stat_t
	if err := unix.Fstat(int(file.Fd()), &snapshot); err != nil {
		return snapshot, err
	}
	info, err := file.Stat()
	if err != nil || info.IsDir() != directory || !directory && (!info.Mode().IsRegular() || snapshot.Nlink != 1) {
		return snapshot, errors.New("support asset is not a safe directory or single-link regular file")
	}
	var aclErr error
	if !fnos.PackageAssetWriteSafe(info.Mode(), snapshot.Uid, uid, func() ([]byte, error) {
		var acl []byte
		acl, aclErr = supportACL(int(file.Fd()))
		return acl, aclErr
	}) {
		if aclErr != nil {
			return snapshot, aclErr
		}
		return snapshot, supportFailure("unsafe_path", errors.New("support asset has an unsafe owner or effective ACL writer"))
	}
	return snapshot, nil
}

func openSupportAt(parent *os.File, name string, directory bool) (*os.File, error) {
	flags := unix.O_RDONLY | unix.O_CLOEXEC | unix.O_NOFOLLOW | unix.O_NONBLOCK
	if directory {
		flags |= unix.O_DIRECTORY
	}
	fd, err := unix.Openat(int(parent.Fd()), name, flags, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(fd), name), nil
}

func openSupportApp(path string, uid uint32) (*os.File, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || path == "/" {
		return nil, errors.New("invalid support application path")
	}
	fd, err := unix.Open("/", unix.O_PATH|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	current := os.NewFile(uintptr(fd), "/")
	if _, err := safeSupportNode(current, uid, true); err != nil {
		current.Close()
		return nil, err
	}
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	for index, part := range parts {
		// Ancestors require traversal, not permission to list their contents.
		// Keep the application directory read-open for exact resource checks.
		flags := unix.O_PATH | unix.O_DIRECTORY | unix.O_NOFOLLOW | unix.O_CLOEXEC
		if index == len(parts)-1 {
			flags = unix.O_RDONLY | unix.O_DIRECTORY | unix.O_NOFOLLOW | unix.O_CLOEXEC
		}
		fd, err := unix.Openat(int(current.Fd()), part, flags, 0)
		current.Close()
		if err != nil {
			if errors.Is(err, unix.EACCES) {
				return nil, supportFailure("support_ancestor_unreadable", err)
			}
			return nil, supportFailure("unsafe_path", err)
		}
		next := os.NewFile(uintptr(fd), part)
		if _, err := safeSupportNode(next, uid, true); err != nil {
			next.Close()
			return nil, err
		}
		current = next
	}
	return current, nil
}

func unchangedSupport(parent *os.File, name string, file *os.File, before unix.Stat_t, uid uint32, directory bool) error {
	after, err := safeSupportNode(file, uid, directory)
	if err != nil {
		return err
	}
	var path unix.Stat_t
	if err := unix.Fstatat(int(parent.Fd()), name, &path, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		return err
	}
	if before.Dev != after.Dev || before.Ino != after.Ino || before.Mode != after.Mode || before.Uid != after.Uid || before.Gid != after.Gid || before.Nlink != after.Nlink || before.Size != after.Size || before.Mtim != after.Mtim || before.Ctim != after.Ctim || after.Dev != path.Dev || after.Ino != path.Ino || after.Mode != path.Mode {
		return errors.New("support asset changed during verification")
	}
	return nil
}

func verifySupportOriginal(parent *os.File, original supportOriginal, uid uint32) error {
	file, err := openSupportAt(parent, original.name, false)
	if err != nil {
		return err
	}
	defer file.Close()
	before, err := safeSupportNode(file, uid, false)
	if err != nil {
		return err
	}
	if before.Size != original.size {
		return supportFailure("approved_asset_mismatch", errors.New("support original size differs from approval"))
	}
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(file, original.size+1))
	if err != nil || n != original.size || fmt.Sprintf("%x", hash.Sum(nil)) != original.hash {
		return supportFailure("approved_asset_mismatch", errors.New("support original differs from the approved bytes"))
	}
	return unchangedSupport(parent, original.name, file, before, uid, false)
}

func exactSupportNames(file *os.File) error {
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	names, err := file.Readdirnames(3)
	if err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	if len(names) != 2 || !((names[0] == approvedSupport[0].name && names[1] == approvedSupport[1].name) || (names[1] == approvedSupport[0].name && names[0] == approvedSupport[1].name)) {
		return errors.New("support directory must contain exactly the approved pair")
	}
	return nil
}

// verifyInstalledSupport returns enabled=false only for the exact explicit
// source-build marker. Every unsafe/missing/changed resource fails closed; the
// lifecycle treats that failure as optional support unavailable, not core failure.
func verifyInstalledSupport(path string, uid uint32) (enabled bool, err error) {
	app, err := openSupportApp(path, uid)
	if err != nil {
		return false, err
	}
	defer app.Close()
	appBefore, err := safeSupportNode(app, uid, true)
	if err != nil {
		return false, err
	}
	var marker unix.Stat_t
	err = unix.Fstatat(int(app.Fd()), disabledSupport.name, &marker, unix.AT_SYMLINK_NOFOLLOW)
	if err == nil {
		var support unix.Stat_t
		if err := unix.Fstatat(int(app.Fd()), "support", &support, unix.AT_SYMLINK_NOFOLLOW); !errors.Is(err, unix.ENOENT) {
			return false, errors.New("disabled support must not coexist with a support directory")
		}
		if err := verifySupportOriginal(app, disabledSupport, uid); err != nil {
			return false, err
		}
	} else {
		if !errors.Is(err, unix.ENOENT) {
			return false, err
		}
		directory, err := openSupportAt(app, "support", true)
		if err != nil {
			return false, err
		}
		defer directory.Close()
		before, err := safeSupportNode(directory, uid, true)
		if err != nil {
			return false, err
		}
		if err := exactSupportNames(directory); err != nil {
			return false, err
		}
		for _, original := range approvedSupport {
			if err := verifySupportOriginal(directory, original, uid); err != nil {
				return false, err
			}
		}
		if err := exactSupportNames(directory); err != nil {
			return false, err
		}
		if err := unchangedSupport(app, "support", directory, before, uid, true); err != nil {
			return false, err
		}
		enabled = true
	}
	appAfter, err := safeSupportNode(app, uid, true)
	if err != nil || appBefore != appAfter {
		return false, errors.New("support application directory changed during verification")
	}
	// Re-open the complete nofollow/ACL-safe chain so a renamed ancestor cannot
	// make the verified descriptor differ from the path the service will open.
	current, err := openSupportApp(path, uid)
	if err != nil {
		return false, err
	}
	defer current.Close()
	currentStat, err := safeSupportNode(current, uid, true)
	if err != nil || currentStat.Dev != appAfter.Dev || currentStat.Ino != appAfter.Ino {
		return false, errors.New("support application path changed during verification")
	}
	return enabled, nil
}
