//go:build !linux

package fnos

import "errors"

func gatewayAccessACL(string) ([]byte, error) {
	// Other platforms retain the strict stat permission check. Linux POSIX
	// ACL encoding and mask semantics must not be assumed on another OS.
	return nil, errors.New("gateway access ACL inspection is only supported on Linux")
}
