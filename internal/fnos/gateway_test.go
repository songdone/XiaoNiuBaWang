package fnos

import (
	"io"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func gatewayTestSocket(t *testing.T) string {
	t.Helper()
	// Keep below macOS's Unix socket pathname limit, as the API tests do.
	dir, err := os.MkdirTemp(".", ".sock-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	socket, err := filepath.Abs(filepath.Join(dir, "g"))
	if err != nil {
		t.Fatal(err)
	}
	return socket
}

func TestListenGatewayPrivateSocket(t *testing.T) {
	socket := gatewayTestSocket(t)
	ln, cleanup, err := ListenGateway(socket)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cleanup)
	info, err := os.Lstat(socket)
	if err != nil || info.Mode()&os.ModeSocket == 0 || info.Mode().Perm() != 0600 {
		t.Fatalf("socket is not private: info=%v err=%v", info, err)
	}
	client, err := net.DialTimeout("unix", socket, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	server, err := ln.Accept()
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	deadline := time.Now().Add(time.Second)
	_ = client.SetDeadline(deadline)
	_ = server.SetDeadline(deadline)
	if _, err := client.Write([]byte("ping")); err != nil {
		t.Fatal(err)
	}
	data := make([]byte, 4)
	if _, err := io.ReadFull(server, data); err != nil || string(data) != "ping" {
		t.Fatalf("roundtrip data=%q err=%v", data, err)
	}
	cleanup()
	if _, err := os.Lstat(socket); !os.IsNotExist(err) {
		t.Fatalf("socket remains after cleanup: %v", err)
	}
}

func TestListenGatewayOccupiedPath(t *testing.T) {
	for _, kind := range []string{"file", "socket"} {
		t.Run(kind, func(t *testing.T) {
			socket := gatewayTestSocket(t)
			if kind == "file" {
				if err := os.WriteFile(socket, []byte("occupied"), 0600); err != nil {
					t.Fatal(err)
				}
			} else {
				_, cleanup, err := ListenGateway(socket)
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(cleanup)
			}
			before, err := os.Lstat(socket)
			if err != nil {
				t.Fatal(err)
			}
			if ln, cleanup, err := ListenGateway(socket); err == nil {
				cleanup()
				t.Fatalf("occupied path accepted: %v", ln)
			}
			after, err := os.Lstat(socket)
			if err != nil || !os.SameFile(before, after) {
				t.Fatalf("occupied path changed: %v", err)
			}
		})
	}
}

func TestListenGatewayCleanupPreservesReplacement(t *testing.T) {
	socket := gatewayTestSocket(t)
	_, cleanup, err := ListenGateway(socket)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cleanup)
	// Keep the original inode alive under a second name to avoid inode reuse.
	if err := os.Rename(socket, socket+".old"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(socket, []byte("replacement"), 0600); err != nil {
		t.Fatal(err)
	}
	cleanup()
	if data, err := os.ReadFile(socket); err != nil || string(data) != "replacement" {
		t.Fatalf("cleanup removed replacement: data=%q err=%v", data, err)
	}
}

func TestListenGatewayRejectsUnsafePaths(t *testing.T) {
	for _, socket := range []string{"relative.sock", "/", "/var/../sock"} {
		if _, cleanup, err := ListenGateway(socket); err == nil {
			cleanup()
			t.Fatalf("unsafe path accepted: %q", socket)
		}
	}
	for _, mode := range []os.FileMode{0775, 0777, 0757} {
		socket := gatewayTestSocket(t)
		if err := os.Chmod(filepath.Dir(socket), mode); err != nil {
			t.Fatal(err)
		}
		if _, cleanup, err := ListenGateway(socket); err == nil {
			cleanup()
			t.Fatalf("non-ACL writable directory accepted: %o", mode)
		}
	}
}
