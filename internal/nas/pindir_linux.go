//go:build linux

package nas

import "golang.org/x/sys/unix"

// O_PATH pins ancestors without requiring permission to list their contents.
// pinDir validates every descriptor and read-opens only the final directory.
func intermediateDirFlags() int {
	return unix.O_PATH | unix.O_DIRECTORY | unix.O_NOFOLLOW | unix.O_CLOEXEC
}
