//go:build linux

package nas

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"

	"golang.org/x/sys/unix"
)

// The child must be unprivileged: root would mask the ancestor-read regression.
// A root local Linux executor drops only this test subprocess to nobody; a
// non-root executor runs with its own identity. No host/device ACL is changed.
func TestPinDirExecuteOnlyAncestorLinux(t *testing.T) {
	if base := os.Getenv("XNBW_PIN_TEST_FIXTURE"); base != "" {
		if os.Geteuid() == 0 {
			t.Fatal("permission regression must run unprivileged")
		}
		t.Logf("permission regression euid=%d egid=%d", os.Geteuid(), os.Getegid())
		ancestor := filepath.Join(base, "search-only")
		target := filepath.Join(ancestor, "roms")
		fd, err := unix.Open(ancestor, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		if err == nil {
			unix.Close(fd)
			t.Fatal("legacy read-open unexpectedly accepted execute-only ancestor")
		}
		if !errors.Is(err, unix.EACCES) {
			t.Fatalf("legacy read-open err=%v", err)
		}
		s := New(diagnosticAuth{paths: []string{target}, user: testUser}, nil)
		result, err := s.RootsDetailed(context.Background(), testUser)
		if err != nil || len(result.Roots) != 1 || result.Diagnostics.Usable != 1 {
			t.Fatalf("search-only ancestor rejected: %+v %v", result, err)
		}
		listing, err := s.Browse(context.Background(), testUser, result.Roots[0].Path)
		if err != nil || len(listing.Entries) != 1 || listing.Entries[0].Name != "good.nes" {
			t.Fatalf("target listing failed %+v %v", listing, err)
		}
		rom, err := s.openROM(context.Background(), testUser, filepath.Join(target, "good.nes"))
		if err != nil {
			t.Fatalf("readonly ROM open failed %v", err)
		}
		if _, err := rom.Write([]byte("mutation")); !errors.Is(err, syscall.EBADF) {
			rom.Close()
			t.Fatalf("ROM descriptor was not read-only: %v", err)
		}
		rom.Close()
		denied := New(diagnosticAuth{paths: []string{target}, denied: map[string]bool{target: true}, user: testUser}, nil)
		if _, err := denied.RootsDetailed(context.Background(), testUser); !errors.Is(err, ErrDenied) {
			t.Fatalf("traversal bypassed current-user ACL: %v", err)
		}
		for _, bad := range []string{filepath.Join(ancestor, "unreadable"), filepath.Join(base, "no-search", "roms"), filepath.Join(base, "linked-ancestor", "roms"), filepath.Join(ancestor, "linked-target")} {
			if dir, err := pinDir(bad); err == nil {
				dir.Close()
				t.Fatal("unreadable or symlink directory accepted")
			}
		}
		return
	}
	base, err := os.MkdirTemp("", "xnbw-pin-permission-")
	if err != nil {
		t.Fatal(err)
	}
	ancestor := filepath.Join(base, "search-only")
	noSearch := filepath.Join(base, "no-search")
	defer func() {
		_ = os.Chmod(ancestor, 0755)
		_ = os.Chmod(noSearch, 0755)
		_ = os.RemoveAll(base)
	}()
	if err = os.Chmod(base, 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(ancestor, 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(noSearch, 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(filepath.Join(noSearch, "roms"), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(noSearch, 0400); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(ancestor, "roms")
	if err = os.Mkdir(target, 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(target, "good.nes"), fixtureROM(), 0444); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(filepath.Join(ancestor, "unreadable"), 0111); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(ancestor, filepath.Join(base, "linked-ancestor")); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(target, filepath.Join(ancestor, "linked-target")); err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(ancestor, 0111); err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(executable, "-test.run=^TestPinDirExecuteOnlyAncestorLinux$", "-test.v")
	cmd.Env = append(os.Environ(), "XNBW_PIN_TEST_FIXTURE="+base)
	if os.Geteuid() == 0 {
		cmd.SysProcAttr = &syscall.SysProcAttr{Credential: &syscall.Credential{Uid: 65534, Gid: 65534, Groups: []uint32{}}}
	}
	output, err := cmd.CombinedOutput()
	t.Logf("parent euid=%s; child output:\n%s", strconv.Itoa(os.Geteuid()), output)
	if err != nil {
		t.Fatalf("unprivileged Linux regression failed: %v", err)
	}
}
