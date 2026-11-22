//go:build !linux

package fnos

import (
	"os"
	"testing"
)

func TestGatewayAccessACLStrictFallback(t *testing.T) {
	if _, err := gatewayAccessACL(t.TempDir()); err == nil {
		t.Fatal("non-Linux ACL inspection must fail closed")
	}
	if gatewayDirectorySafe(os.ModeDir|0775, 982, 982, func() ([]byte, error) {
		return gatewayAccessACL("unused")
	}) {
		t.Fatal("non-Linux group write accepted")
	}
}
