//go:build linux

package main

import (
	"encoding/binary"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"

	"golang.org/x/sys/unix"
)

func installedSupportACL(uid uint32, group uint16) []byte {
	data := make([]byte, 44)
	binary.LittleEndian.PutUint32(data, 2)
	entries := []struct {
		tag, perm uint16
		id        uint32
	}{
		{1, 7, 0xffffffff}, {2, 7, uid}, {4, group, 0xffffffff}, {16, 7, 0xffffffff}, {32, 5, 0xffffffff},
	}
	for i, entry := range entries {
		pos := 4 + i*8
		binary.LittleEndian.PutUint16(data[pos:], entry.tag)
		binary.LittleEndian.PutUint16(data[pos+2:], entry.perm)
		binary.LittleEndian.PutUint32(data[pos+4:], entry.id)
	}
	return data
}

func TestSupportOpenedNodeInstalledACL0775(t *testing.T) {
	uid := uint32(os.Geteuid())
	for _, directory := range []bool{false, true} {
		path := filepath.Join(t.TempDir(), "asset")
		if directory {
			if err := os.Mkdir(path, 0755); err != nil {
				t.Fatal(err)
			}
		} else if err := os.WriteFile(path, []byte("fixture"), 0644); err != nil {
			t.Fatal(err)
		}
		if err := unix.Setxattr(path, "system.posix_acl_access", installedSupportACL(uid, 5), 0); err != nil {
			if errors.Is(err, unix.EOPNOTSUPP) || errors.Is(err, unix.ENOSYS) {
				t.Skipf("filesystem lacks POSIX ACLs: %v", err)
			}
			t.Fatal(err)
		}
		file, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		info, err := file.Stat()
		if err != nil || info.Mode().Perm() != 0775 {
			t.Fatalf("ACL mask must appear as 0775: %v %v", info, err)
		}
		if _, err := safeSupportNode(file, uid, directory); err != nil {
			t.Fatalf("safe installed ACL rejected: %v", err)
		}
		if directory {
			fd, err := unix.Open(path, unix.O_PATH|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
			if err != nil {
				t.Fatal(err)
			}
			pinned := os.NewFile(uintptr(fd), "pinned-ancestor")
			if _, err := safeSupportNode(pinned, uid, true); err != nil {
				pinned.Close()
				t.Fatalf("O_PATH same-inode safe ACL rejected: %v", err)
			}
			if err := unix.Setxattr(path, "system.posix_acl_access", installedSupportACL(uid, 7), 0); err != nil {
				pinned.Close()
				t.Fatal(err)
			}
			if _, err := safeSupportNode(pinned, uid, true); err == nil {
				pinned.Close()
				t.Fatal("O_PATH effective owning-group writer accepted")
			}
			pinned.Close()
		}
		if err := unix.Setxattr(path, "system.posix_acl_access", installedSupportACL(uid, 7), 0); err != nil {
			t.Fatal(err)
		}
		if _, err := safeSupportNode(file, uid, directory); err == nil {
			t.Fatal("effective owning-group writer accepted")
		}
		file.Close()
	}
}

func TestSupportOpenAtNoFollowAndHash(t *testing.T) {
	parent, err := os.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer parent.Close()
	path := filepath.Join(parent.Name(), "original")
	if err := os.WriteFile(path, []byte("wrong"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := verifySupportOriginal(parent, supportOriginal{"original", 5, "not the approved hash"}, uint32(os.Geteuid())); err == nil {
		t.Fatal("mutated original accepted")
	}
	if err := os.Symlink(path, filepath.Join(parent.Name(), "link")); err != nil {
		t.Fatal(err)
	}
	if file, err := openSupportAt(parent, "link", false); err == nil {
		file.Close()
		t.Fatal("image symlink accepted")
	}
	if err := os.Link(path, filepath.Join(parent.Name(), "hardlink")); err != nil {
		t.Fatal(err)
	}
	file, err := openSupportAt(parent, "original", false)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if _, err := safeSupportNode(file, uint32(os.Geteuid()), false); err == nil {
		t.Fatal("hardlinked image accepted")
	}
	if err := exactSupportNames(parent); err == nil {
		t.Fatal("extra support names accepted")
	}
}

// Real Linux permission regression. Supply a trusted writable fixture root and
// the exact approved originals as two read-only mounted files. /tmp is not a
// valid chain (world-writable); mocks and root execution cannot prove this test.
func TestSupportExecuteOnlyAncestorLinux(t *testing.T) {
	base := os.Getenv("SUPPORT_ALIAS_TEST_ROOT")
	originals := os.Getenv("SUPPORT_ORIGINALS_DIR")
	if base == "" || originals == "" {
		t.Skip("requires trusted SUPPORT_ALIAS_TEST_ROOT and exact SUPPORT_ORIGINALS_DIR")
	}
	if os.Geteuid() == 0 {
		fixture, err := os.MkdirTemp(base, "nonroot-support-")
		if err != nil {
			t.Fatal(err)
		}
		defer os.RemoveAll(fixture)
		if err := os.Chown(fixture, 65534, 65534); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(fixture, 0755); err != nil {
			t.Fatal(err)
		}
		executable, err := os.Executable()
		if err != nil {
			t.Fatal(err)
		}
		cmd := exec.Command(executable, "-test.run=^TestSupportExecuteOnlyAncestorLinux$", "-test.v")
		cmd.Env = append(os.Environ(), "SUPPORT_ALIAS_TEST_ROOT="+fixture)
		cmd.SysProcAttr = &syscall.SysProcAttr{Credential: &syscall.Credential{Uid: 65534, Gid: 65534, Groups: []uint32{}}}
		output, err := cmd.CombinedOutput()
		t.Logf("non-root child output:\n%s", output)
		if err != nil {
			t.Fatalf("unprivileged regression failed: %v", err)
		}
		return
	}
	t.Logf("real permission regression euid=%d egid=%d", os.Geteuid(), os.Getegid())
	fixture, err := os.MkdirTemp(base, "support-chain-")
	if err != nil {
		t.Fatal(err)
	}
	ancestor := filepath.Join(fixture, "search-only")
	app := filepath.Join(ancestor, "app")
	support := filepath.Join(app, "support")
	defer func() {
		_ = os.Chmod(ancestor, 0755)
		_ = os.Chmod(support, 0755)
		_ = os.RemoveAll(fixture)
	}()
	if err := os.MkdirAll(support, 0755); err != nil {
		t.Fatal(err)
	}
	for _, original := range approvedSupport {
		data, err := os.ReadFile(filepath.Join(originals, original.name))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(support, original.name), data, 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chmod(ancestor, 0111); err != nil {
		t.Fatal(err)
	}
	fd, err := unix.Open(ancestor, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err == nil {
		unix.Close(fd)
		t.Fatal("old O_RDONLY ancestor open unexpectedly succeeded")
	}
	if !errors.Is(err, unix.EACCES) {
		t.Fatalf("expected old EACCES, got %v", err)
	}
	t.Log("old O_RDONLY ancestor open = EACCES")
	alias := filepath.Join(fixture, "official-alias")
	if err := os.Symlink(app, alias); err != nil {
		t.Fatal(err)
	}
	check := func() {
		t.Helper()
		canonical, enabled, err := verifyPlatformSupport(alias, uint32(os.Geteuid()))
		if err != nil || !enabled || canonical != app {
			t.Fatalf("exact approved pair through execute-only ancestor rejected: enabled=%v code=%s", enabled, supportErrorCode(err))
		}
	}
	check()
	t.Log("new O_PATH chain + approved exact hashes = enabled")
	jpeg := filepath.Join(support, approvedSupport[0].name)
	for _, path := range []string{ancestor, support, jpeg} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		mode := os.FileMode(0000)
		if path == support {
			mode = 0111 // final directory must still be readable for exact names
		}
		if err := os.Chmod(path, mode); err != nil {
			t.Fatal(err)
		}
		if _, _, err := verifyPlatformSupport(alias, uint32(os.Geteuid())); err == nil {
			t.Fatal("missing ancestor traversal or final directory/JPEG read was accepted")
		}
		if err := os.Chmod(path, info.Mode().Perm()); err != nil {
			t.Fatal(err)
		}
		check()
	}
	if err := os.Chmod(ancestor, 0775); err != nil {
		t.Fatal(err)
	}
	if _, _, err := verifyPlatformSupport(alias, uint32(os.Geteuid())); err == nil {
		t.Fatal("unproven group-writable ancestor accepted")
	}
	if err := os.Chmod(ancestor, 0111); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(fixture, "extra-hardlink")
	if err := os.Link(jpeg, link); err != nil {
		t.Fatal(err)
	}
	if _, _, err := verifyPlatformSupport(alias, uint32(os.Geteuid())); err == nil {
		t.Fatal("nlink>1 approved JPEG accepted")
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	file, err := os.OpenFile(jpeg, os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteAt([]byte("not approved"), 0); err != nil {
		file.Close()
		t.Fatal(err)
	}
	file.Close()
	if _, _, err := verifyPlatformSupport(alias, uint32(os.Geteuid())); supportErrorCode(err) != "approved_asset_mismatch" {
		t.Fatalf("mutated JPEG did not report fixed mismatch code: %s", supportErrorCode(err))
	}
	// Restore the user's bytes only in this disposable test fixture.
	input, err := os.Open(filepath.Join(originals, approvedSupport[0].name))
	if err != nil {
		t.Fatal(err)
	}
	output, err := os.Create(jpeg)
	if err != nil {
		input.Close()
		t.Fatal(err)
	}
	_, err = io.Copy(output, input)
	input.Close()
	output.Close()
	if err != nil {
		t.Fatal(err)
	}
	check()
	if _, _, err := verifyPlatformSupport(alias, uint32(os.Geteuid())+1); err == nil {
		t.Fatal("foreign-owned alias chain accepted")
	}
}
