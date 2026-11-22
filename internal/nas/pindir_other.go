//go:build !linux

package nas

import "golang.org/x/sys/unix"

// Preserve the existing no-follow directory-open behavior for local non-Linux
// test environments; Linux package execution uses traversal-only O_PATH.
func intermediateDirFlags() int {
	return unix.O_RDONLY | unix.O_DIRECTORY | unix.O_NOFOLLOW | unix.O_NONBLOCK | unix.O_CLOEXEC
}
