//go:build linux || darwin

package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestPlatformSupportAliasSafety(t *testing.T) {
	base := os.Getenv("SUPPORT_ALIAS_TEST_ROOT")
	if base == "" {
		t.Skip("set SUPPORT_ALIAS_TEST_ROOT to an owned directory beneath trusted ancestors")
	}
	fixture, err := os.MkdirTemp(base, "platform-alias-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(fixture)
	fixture, err = filepath.Abs(fixture)
	if err != nil {
		t.Fatal(err)
	}
	uid := uint32(os.Geteuid())
	acl := func(string) ([]byte, error) { return nil, nil }
	actual := filepath.Join(fixture, "actual")
	if err := os.Mkdir(actual, 0755); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(fixture, "target")
	if err := os.Symlink("actual", alias); err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveSupportAlias(alias, uid, acl)
	if err != nil || resolved != actual {
		t.Fatalf("safe relative official alias rejected: %q %v", resolved, err)
	}
	absolute := filepath.Join(fixture, "absolute")
	if err := os.Symlink(actual, absolute); err != nil {
		t.Fatal(err)
	}
	if resolved, err := resolveSupportAlias(absolute, uid, acl); err != nil || resolved != actual {
		t.Fatalf("safe absolute alias rejected: %q %v", resolved, err)
	}
	if _, err := resolveSupportAlias(alias, uid+1, acl); err == nil {
		t.Fatal("foreign-owned alias chain accepted")
	}
	if err := os.Chmod(fixture, 0777); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveSupportAlias(alias, uid, acl); err == nil {
		t.Fatal("untrusted writable alias parent accepted")
	}
	if err := os.Chmod(fixture, 0700); err != nil {
		t.Fatal(err)
	}
	loop := filepath.Join(fixture, "loop")
	if err := os.Symlink("loop", loop); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveSupportAlias(loop, uid, acl); err == nil {
		t.Fatal("alias loop accepted")
	}
}

func TestSupportVerificationErrorCodesDoNotExposePaths(t *testing.T) {
	secret := errors.New("/private/physical/path user=secret")
	for _, code := range []string{"support_ancestor_unreadable", "unsafe_path", "approved_asset_mismatch", "support_acl_unreadable"} {
		err := supportFailure(code, secret)
		if supportErrorCode(err) != code || err.Error() != code || !errors.Is(err, secret) {
			t.Fatal("fixed diagnostic code or underlying error identity lost")
		}
	}
	if supportErrorCode(secret) != "unsafe_path" || supportErrorCode(supportFailure("/private/path", secret)) != "unsafe_path" {
		t.Fatal("unclassified error exposed private detail")
	}
}
