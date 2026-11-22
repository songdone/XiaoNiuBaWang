package store_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"xiaoniubawang/internal/fnos"
	"xiaoniubawang/internal/library"
	"xiaoniubawang/internal/saves"
	"xiaoniubawang/internal/store"
)

func TestSQLiteReopenAndPrivatePayloads(t *testing.T) {
	ctx := t.Context()
	data := filepath.Join(t.TempDir(), "private?#game")
	open := func() (*store.Store, *library.Service, *saves.Service) {
		t.Helper()
		st, err := store.Open(ctx, data)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = st.Close() })
		lib, err := library.New(ctx, st, "")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = lib.Close() })
		return st, lib, saves.New(st, lib)
	}
	st, lib, sv := open()
	u1, u2 := fnos.User("uid-729"), fnos.User("uid-730")
	if duplicate, err := store.Open(ctx, data); err == nil {
		_ = duplicate.Close()
		t.Fatal("allowed two writers in one private directory")
	}
	rom := make([]byte, 16+16384)
	copy(rom, "NES\x1a")
	rom[4] = 1
	copy(rom[100:], "rom-payload-marked-only-for-files")
	imported, err := lib.Import(ctx, u1, []library.Upload{{Filename: "source.nes", Reader: bytes.NewReader(rom)}})
	if err != nil || len(imported) != 1 {
		t.Fatalf("import: %+v, %v", imported, err)
	}
	game := imported[0]
	if _, err = lib.Favorite(ctx, u1, game.ID, true); err != nil {
		t.Fatal(err)
	}
	for _, record := range []struct {
		at string
		n  int64
	}{{"2026-11-21T12:00:00Z", 7}, {"2026-11-20T12:00:00Z", 2}} {
		if err := st.RestoreActivity(ctx, u1, game.ID, record.at, record.n); err != nil {
			t.Fatal(err)
		}
	}
	if err = st.RestoreActivity(ctx, u2, game.ID, "2026-11-21T12:00:00Z", 7); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("activity crossed user boundary: %v", err)
	}
	if err = st.SetSettings(ctx, u1, `{"volume":0.25}`); err != nil {
		t.Fatal(err)
	}
	slot, err := sv.Create(ctx, u1, saves.Input{GameID: game.ID, Kind: "state", Slot: 2, Core: "fceumm", CoreVersion: "0.98", ROMSHA256: game.SHA256}, strings.NewReader("previous"))
	if err != nil {
		t.Fatal(err)
	}
	const snapshot = "state-payload-marked-only-for-files"
	slot, err = sv.Update(ctx, u1, slot.ID, slot.ETag, saves.Assertions{}, strings.NewReader(snapshot))
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := os.ReadFile(filepath.Join(data, "metadata.sqlite"))
	if err != nil || !bytes.HasPrefix(db, []byte("SQLite format 3\x00")) || bytes.Contains(db, []byte(snapshot)) || bytes.Contains(db, []byte("rom-payload-marked-only-for-files")) {
		t.Fatalf("invalid on-disk metadata store or leaked payload: %v", err)
	}
	entries, err := os.ReadDir(filepath.Join(data, string(u1)))
	if err != nil || len(entries) != 2 {
		t.Fatalf("expected only current ROM and state snapshots in user directory, got %d, err %v", len(entries), err)
	}
	st, lib, sv = open()
	if err := st.Health(ctx); err != nil {
		t.Fatal(err)
	}
	if got, err := st.Settings(ctx, u1); err != nil || got != `{"volume":0.25}` {
		t.Fatalf("settings lost across reopen: %q, %v", got, err)
	}
	g, rf, err := lib.Open(ctx, u1, game.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rf.Close() })
	romAfter, err := io.ReadAll(rf)
	if err != nil || !bytes.Equal(romAfter, rom) || !g.Favorite || g.PlayCount != 7 || !strings.HasPrefix(g.LastPlayedAt, "2026-11-21T12:00:00") {
		t.Fatalf("game or activity lost across reopen: %+v, %v", g, err)
	}
	v, sf, err := sv.Open(ctx, u1, slot.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sf.Close() })
	saved, err := io.ReadAll(sf)
	wantHash := sha256.Sum256([]byte(snapshot))
	if err != nil || string(saved) != snapshot || v.Version != 2 || v.ETag != slot.ETag || v.SHA256 != hex.EncodeToString(wantHash[:]) {
		t.Fatalf("snapshot lost across reopen: %+v, %q, %v", v, saved, err)
	}
	if _, err := sv.Get(ctx, u2, slot.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("snapshot crossed user boundary after reopening: %v", err)
	}
	if err = os.WriteFile(filepath.Join(data, string(u1), v.BlobKey), bytes.Repeat([]byte{'x'}, len(snapshot)), 0600); err != nil {
		t.Fatal(err)
	}
	if _, f, err := sv.Open(ctx, u1, slot.ID); f != nil || !errors.Is(err, store.ErrCorrupt) {
		t.Fatalf("same-length on-disk corruption was not rejected: %v", err)
	}
}

func TestAppStorageRejectsLinksAndTraversal(t *testing.T) {
	ctx := t.Context()
	dir := t.TempDir()
	data := filepath.Join(dir, "data")
	if err := os.Mkdir(data, 0700); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(dir, "outside")
	if err := os.WriteFile(outside, []byte("unguessable"), 0600); err != nil {
		t.Fatal(err)
	}
	metadata := filepath.Join(data, "metadata.sqlite")
	if err := os.Symlink(outside, metadata); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Open(ctx, data); !errors.Is(err, store.ErrCorrupt) {
		t.Fatalf("database link should be refused: %v", err)
	}
	if err := os.Remove(metadata); err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(ctx, data)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if _, err := st.WriteBlob(ctx, "uid-../../escape", "rom", strings.NewReader("data"), 32); !errors.Is(err, store.ErrInvalid) {
		t.Fatalf("traversal in a backing identity was not refused: %v", err)
	}
	if err := os.Symlink(dir, filepath.Join(data, "uid-12")); err != nil {
		t.Fatal(err)
	}
	if _, err := st.WriteBlob(ctx, "uid-12", "rom", strings.NewReader("data"), 32); !errors.Is(err, store.ErrCorrupt) {
		t.Fatalf("user directory symlink was not refused: %v", err)
	}
	v, err := st.WriteBlob(ctx, "uid-11", "rom", strings.NewReader("unguessable"), 32)
	if err != nil {
		t.Fatal(err)
	}
	realFile := filepath.Join(data, "uid-11", v.Key)
	if err = os.Remove(realFile); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(outside, realFile); err != nil {
		t.Fatal(err)
	}
	if f, err := st.OpenBlob(ctx, "uid-11", v); err == nil {
		_ = f.Close()
		t.Fatal("blob symlink escaped its root")
	}
	if err := st.RemoveBlob("uid-11", "../../outside"); !errors.Is(err, store.ErrInvalid) {
		t.Fatalf("traversal accepted for unlink: %v", err)
	}
	if outsideBytes, err := os.ReadFile(outside); err != nil || string(outsideBytes) != "unguessable" {
		t.Fatalf("outside file changed: %q, %v", outsideBytes, err)
	}
}
