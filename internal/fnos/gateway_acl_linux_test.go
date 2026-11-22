//go:build linux

package fnos

import (
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func TestGatewayAccessACLOnLinux(t *testing.T) {
	socket := gatewayTestSocket(t)
	dir := filepath.Dir(socket)
	if _, err := gatewayAccessACL(filepath.Join(dir, "missing")); err == nil {
		t.Fatal("missing path accepted")
	}
	if err := os.Chmod(dir, 0775); err != nil {
		t.Fatal(err)
	}
	if _, err := gatewayAccessACL(dir); err == nil {
		t.Fatal("directory without an access ACL accepted")
	}
	data := recordedACL(t)
	binary.LittleEndian.PutUint32(data[16:], uint32(os.Geteuid()))
	if err := unix.Setxattr(dir, "system.posix_acl_access", data, 0); err != nil {
		if errors.Is(err, unix.EOPNOTSUPP) || errors.Is(err, unix.ENOSYS) {
			t.Skipf("local filesystem does not support POSIX ACLs: %v", err)
		}
		t.Fatal(err)
	}
	info, err := os.Stat(dir)
	if err != nil || info.Mode().Perm() != 0775 {
		t.Fatalf("stat does not expose writable ACL mask: info=%v err=%v", info, err)
	}
	acl, err := gatewayAccessACL(dir)
	if err != nil || !gatewayACLWriteSafe(acl, info.Mode(), uint32(os.Geteuid())) {
		t.Fatalf("safe access ACL rejected: %v", err)
	}
	_, cleanup, err := ListenGateway(socket)
	if err != nil {
		t.Fatal(err)
	}
	cleanup()
	// The same writable mask must not permit an actual owning-group writer.
	binary.LittleEndian.PutUint16(data[22:], 7)
	if err := unix.Setxattr(dir, "system.posix_acl_access", data, 0); err != nil {
		t.Fatal(err)
	}
	if _, cleanup, err := ListenGateway(socket); err == nil {
		cleanup()
		t.Fatal("effective owning-group write accepted")
	}
}
