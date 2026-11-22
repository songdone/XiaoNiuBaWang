//go:build linux

package fnos

import (
	"errors"

	"golang.org/x/sys/unix"
)

func gatewayAccessACL(path string) ([]byte, error) {
	const attr = "system.posix_acl_access"
	size, err := unix.Getxattr(path, attr, nil)
	if err != nil {
		return nil, err
	}
	if size <= 0 || size > 65536 {
		return nil, errors.New("invalid gateway access ACL size")
	}
	data := make([]byte, size)
	n, err := unix.Getxattr(path, attr, data)
	if err != nil {
		return nil, err
	}
	if n != size {
		return nil, errors.New("gateway access ACL changed while reading")
	}
	return data, nil
}
