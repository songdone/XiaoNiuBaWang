package backup

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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

const owner fnos.User = "uid-1001"

type testBackend struct {
	st     *store.Store
	lib    *library.Service
	sv     *saves.Service
	backup *Service
}

func backend(t *testing.T) *testBackend {
	return backendWithCatalog(t, "")
}

func backendWithCatalog(t *testing.T, catalog string) *testBackend {
	t.Helper()
	data := t.TempDir()
	if err := os.Chmod(data, 0700); err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(context.Background(), data)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	lib, err := library.New(context.Background(), st, catalog)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	sv := saves.New(st, lib)
	return &testBackend{st, lib, sv, New(st, lib, sv)}
}
func rom() []byte {
	b := make([]byte, 16+16384)
	copy(b, "NES\x1a")
	b[4] = 1
	for i := 16; i < len(b); i++ {
		b[i] = byte(i % 251)
	}
	return b
}
func digest(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func seed(t *testing.T, b *testBackend, user fnos.User) (store.Game, []byte) {
	t.Helper()
	ctx := context.Background()
	games, err := b.lib.Import(ctx, user, []library.Upload{{Filename: "fixture.nes", Title: "备份测试", Reader: bytes.NewReader(rom())}})
	if err != nil {
		t.Fatal(err)
	}
	g, err := b.lib.Favorite(ctx, user, games[0].ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = b.lib.Launch(ctx, user, g.ID); err != nil {
		t.Fatal(err)
	}
	state := append([]byte("FCSX\x00\xff\x01"), bytes.Repeat([]byte{0x10, 0x20, 0x30, 0x40}, 4096)...)
	if _, err = b.sv.Create(ctx, user, saves.Input{GameID: g.ID, Kind: "state", Slot: 4, Core: "fceumm", CoreVersion: "1.0-test", ROMSHA256: g.SHA256, SHA256: digest(state)}, bytes.NewReader(state)); err != nil {
		t.Fatal(err)
	}
	if _, err = b.sv.Create(ctx, user, saves.Input{GameID: g.ID, Kind: "sram", Slot: 0, Core: "fceumm", CoreVersion: "1.0-test", ROMSHA256: g.SHA256}, bytes.NewReader([]byte{0, 1, 2, 255, 0, 7})); err != nil {
		t.Fatal(err)
	}
	if err = b.st.SetSettings(ctx, user, `{"volume":0.4,"keyboard":{"A":"J","B":"K"},"language":"zh-CN"}`); err != nil {
		t.Fatal(err)
	}
	g, err = b.lib.Get(ctx, user, g.ID)
	if err != nil {
		t.Fatal(err)
	}
	return g, state
}
func exported(t *testing.T, b *testBackend, user fnos.User) []byte {
	t.Helper()
	data, err := b.backup.ExportBytes(context.Background(), user)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestRealExportRestoreRoundTripAndUserIsolation(t *testing.T) {
	ctx := context.Background()
	source := backend(t)
	original, state := seed(t, source, owner)
	// Another user's save/settings must never enter this owner's archive.
	other := fnos.User("uid-1002")
	_, _ = source.lib.Import(ctx, other, []library.Upload{{Filename: "private.nes", Title: "other-user-private", Reader: bytes.NewReader(rom())}})
	if err := source.st.SetSettings(ctx, other, `{"private":"other-user-secret"}`); err != nil {
		t.Fatal(err)
	}
	data := exported(t, source, owner)
	v, err := validate(ctx, bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if len(v.manifest.Games) != 1 || len(v.manifest.Saves) != 2 || v.manifest.Games[0].LastPlayedAt == "" || v.manifest.Games[0].PlayCount != 1 {
		t.Fatalf("manifest %+v", v.manifest)
	}
	for name, b := range v.data {
		if bytes.Contains(b, []byte("other-user-secret")) {
			t.Fatalf("cross-user secret in %s", name)
		}
	}
	manifestBytes, _ := json.Marshal(v.manifest)
	if bytes.Contains(manifestBytes, []byte("/Users/")) || bytes.Contains(manifestBytes, []byte("/private/")) || bytes.Contains(manifestBytes, []byte("blobKey")) {
		t.Fatal("physical storage paths leaked")
	}
	dest := backend(t)
	out, err := dest.backup.Restore(ctx, owner, bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if out.ImportedGames != 1 || out.RestoredSaves != 2 || !out.SettingsRestored {
		t.Fatalf("restore %+v", out)
	}
	games, err := dest.lib.List(ctx, owner)
	if err != nil || len(games) != 1 || games[0].ID == original.ID || games[0].SHA256 != original.SHA256 || !games[0].Favorite {
		t.Fatalf("games %+v %v", games, err)
	}
	if games[0].PlayCount != original.PlayCount || games[0].LastPlayedAt != original.LastPlayedAt {
		t.Fatalf("recent activity not restored: %+v", games[0])
	}
	_, f, err := dest.lib.Open(ctx, owner, games[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := io.ReadAll(f)
	f.Close()
	if err != nil || !bytes.Equal(actual, rom()) {
		t.Fatal("ROM bytes not restored")
	}
	slots, err := dest.sv.List(ctx, owner, games[0].ID)
	if err != nil || len(slots) != 2 {
		t.Fatalf("slots %+v %v", slots, err)
	}
	for _, slot := range slots {
		if slot.Version != 1 || slot.GameID != games[0].ID || slot.ROMSHA256 != original.SHA256 {
			t.Fatalf("wrong restored association %+v", slot)
		}
		_, f, err := dest.sv.Open(ctx, owner, slot.ID)
		if err != nil {
			t.Fatal(err)
		}
		actual, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			t.Fatal(err)
		}
		if slot.Kind == "state" && !bytes.Equal(actual, state) {
			t.Fatal("actual state bytes differ")
		}
		if slot.Kind == "sram" && !bytes.Equal(actual, []byte{0, 1, 2, 255, 0, 7}) {
			t.Fatal("actual SRAM bytes differ")
		}
	}
	settings, err := dest.st.Settings(ctx, owner)
	if err != nil || !strings.Contains(settings, `"language":"zh-CN"`) {
		t.Fatalf("settings %s %v", settings, err)
	}
	privateGames, err := dest.lib.List(ctx, other)
	if err != nil || len(privateGames) != 0 {
		t.Fatal("restored data became visible to another user")
	}
	for _, slot := range slots {
		if _, _, err := dest.sv.Open(ctx, other, slot.ID); !errors.Is(err, store.ErrNotFound) {
			t.Fatalf("other user opened save: %v", err)
		}
	}
	if err := dest.st.RestoreActivity(ctx, owner, games[0].ID, "2030-01-01T00:00:00Z", 9); err != nil {
		t.Fatal(err)
	}
	// Idempotent retry preserves all original destination save IDs and versions.
	out, err = dest.backup.Restore(ctx, owner, bytes.NewReader(data), int64(len(data)))
	if err != nil || out.ImportedGames != 0 || out.ExistingGames != 1 || out.RestoredSaves != 0 {
		t.Fatalf("retry %+v %v", out, err)
	}
	latest, err := dest.lib.Get(ctx, owner, games[0].ID)
	if err != nil || latest.PlayCount != 9 || !strings.HasPrefix(latest.LastPlayedAt, "2030-01-01T00:00:00") {
		t.Fatalf("newer local history overwritten: %+v %v", latest, err)
	}
	conflicts := 0
	for _, c := range out.Conflicts {
		if c.Kind == "save" {
			conflicts++
		}
	}
	if conflicts != 2 {
		t.Fatalf("occupied slots did not return conflicts %+v", out)
	}
	after, err := dest.sv.List(ctx, owner, games[0].ID)
	if err != nil || len(after) != len(slots) {
		t.Fatal("slots changed")
	}
	for i, slot := range after {
		if slot.ID != slots[i].ID || slot.Version != slots[i].Version || slot.SHA256 != slots[i].SHA256 {
			t.Fatal("restore overwrote existing save")
		}
	}
}

func TestRestorePreservesBundledAndImportedIdentityWithSameROM(t *testing.T) {
	ctx := context.Background()
	catalog := t.TempDir()
	romBytes := rom()
	const bundledID = "bundled-shared-rom"
	const bundledTitle = "内置原版"
	const importedTitle = "我的中文改名"
	if err := os.WriteFile(filepath.Join(catalog, "bundled.nes"), romBytes, 0600); err != nil {
		t.Fatal(err)
	}
	catalogJSON, err := json.Marshal(map[string]any{"games": []map[string]string{{
		"id": bundledID, "title": bundledTitle, "filename": "bundled.nes", "sha256": digest(romBytes),
		"license": "CC0-1.0", "sourceUrl": "https://example.invalid/fixtures/bundled.nes",
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(catalog, "catalog.json"), catalogJSON, 0600); err != nil {
		t.Fatal(err)
	}

	source := backendWithCatalog(t, catalog)
	imported, err := source.lib.Import(ctx, owner, []library.Upload{{Filename: "personal.nes", Title: "个人导入原名", Reader: bytes.NewReader(romBytes)}})
	if err != nil || len(imported) != 1 {
		t.Fatalf("source import %+v %v", imported, err)
	}
	if _, err := source.lib.Rename(ctx, owner, imported[0].ID, importedTitle); err != nil {
		t.Fatal(err)
	}
	type identity struct {
		id           string
		title        string
		favorite     bool
		lastPlayedAt string
		playCount    int64
		state        []byte
	}
	identities := map[string]identity{
		"bundled":  {bundledID, bundledTitle, false, "2025-11-01T02:03:04Z", 3, []byte{'B', 'U', 'I', 'L', 'T', 0, 255, 1}},
		"imported": {imported[0].ID, importedTitle, true, "2026-10-10T05:06:07Z", 11, []byte{'M', 'I', 'N', 'E', 0, 128, 9, 8, 7}},
	}
	sourceGames := map[string]store.Game{}
	sourceSaves := map[string]store.Save{}
	for kind, want := range identities {
		if _, err := source.lib.Favorite(ctx, owner, want.id, want.favorite); err != nil {
			t.Fatal(err)
		}
		if err := source.st.RestoreActivity(ctx, owner, want.id, want.lastPlayedAt, want.playCount); err != nil {
			t.Fatal(err)
		}
		game, err := source.lib.Get(ctx, owner, want.id)
		if err != nil {
			t.Fatal(err)
		}
		sourceGames[kind] = game
		slot, err := source.sv.Create(ctx, owner, saves.Input{GameID: game.ID, Kind: "state", Slot: 4, Core: "fceumm", CoreVersion: "1.0-test", ROMSHA256: game.SHA256, SHA256: digest(want.state)}, bytes.NewReader(want.state))
		if err != nil {
			t.Fatal(err)
		}
		sourceSaves[kind] = slot
	}
	games, err := source.lib.List(ctx, owner)
	if err != nil || len(games) != 2 || sourceGames["bundled"].SHA256 != sourceGames["imported"].SHA256 || sourceGames["bundled"].ID == sourceGames["imported"].ID {
		t.Fatalf("source identities %+v %v", games, err)
	}
	data := exported(t, source, owner)
	validated, err := validate(ctx, bytes.NewReader(data), int64(len(data)))
	if err != nil || len(validated.manifest.Games) != 2 || len(validated.manifest.Saves) != 2 {
		t.Fatalf("exported identities %+v %v", validated.manifest, err)
	}

	for _, existingImported := range []bool{false, true} {
		name := "fresh destination"
		if existingImported {
			name = "existing imported title preserved"
		}
		t.Run(name, func(t *testing.T) {
			dest := backendWithCatalog(t, catalog)
			wantImportedTitle := importedTitle
			var existingID string
			if existingImported {
				wantImportedTitle = "目标库已有个人标题"
				local, err := dest.lib.Import(ctx, owner, []library.Upload{{Filename: "local.nes", Title: wantImportedTitle, Reader: bytes.NewReader(romBytes)}})
				if err != nil || len(local) != 1 {
					t.Fatalf("destination import %+v %v", local, err)
				}
				existingID = local[0].ID
			}
			out, err := dest.backup.Restore(ctx, owner, bytes.NewReader(data), int64(len(data)))
			wantImported, wantExisting := 1, 1
			if existingImported {
				wantImported, wantExisting = 0, 2
			}
			if err != nil || out.ImportedGames != wantImported || out.ExistingGames != wantExisting || out.RestoredSaves != 2 || len(out.Conflicts) != 0 || !out.SettingsRestored {
				t.Fatalf("restore %+v %v", out, err)
			}

			assertDestination := func() map[string]store.Save {
				t.Helper()
				games, err := dest.lib.List(ctx, owner)
				if err != nil || len(games) != 2 {
					t.Fatalf("destination identities %+v %v", games, err)
				}
				seen := map[string]bool{}
				slots := map[string]store.Save{}
				for _, game := range games {
					want, ok := identities[game.Source]
					if !ok || seen[game.Source] {
						t.Fatalf("source identities merged or duplicated: %+v", games)
					}
					seen[game.Source] = true
					wantTitle := want.title
					if game.Source == "imported" {
						wantTitle = wantImportedTitle
						if game.ID == imported[0].ID || game.ID == bundledID || existingID != "" && game.ID != existingID {
							t.Fatalf("imported destination ID not isolated: %+v", game)
						}
					} else if game.ID != bundledID {
						t.Fatalf("bundled catalog ID changed: %+v", game)
					}
					original := sourceGames[game.Source]
					if game.Title != wantTitle || game.Favorite != want.favorite || game.LastPlayedAt != original.LastPlayedAt || game.PlayCount != want.playCount || game.SHA256 != digest(romBytes) || game.Size != int64(len(romBytes)) {
						t.Fatalf("metadata crossed source boundary: got=%+v want=%+v", game, want)
					}
					_, f, err := dest.lib.Open(ctx, owner, game.ID)
					if err != nil {
						t.Fatal(err)
					}
					actual, readErr := io.ReadAll(f)
					f.Close()
					if readErr != nil || !bytes.Equal(actual, romBytes) {
						t.Fatalf("%s ROM bytes differ: %v", game.Source, readErr)
					}
					states, err := dest.sv.List(ctx, owner, game.ID)
					if err != nil || len(states) != 1 {
						t.Fatalf("%s slots %+v %v", game.Source, states, err)
					}
					slot := states[0]
					if slot.ID == sourceSaves[game.Source].ID || slot.GameID != game.ID || slot.Kind != "state" || slot.Slot != 4 || slot.Core != "fceumm" || slot.CoreVersion != "1.0-test" || slot.Version != 1 || slot.ROMSHA256 != game.SHA256 || slot.SHA256 != digest(want.state) || slot.Size != int64(len(want.state)) {
						t.Fatalf("%s save association crossed source boundary: %+v", game.Source, slot)
					}
					_, f, err = dest.sv.Open(ctx, owner, slot.ID)
					if err != nil {
						t.Fatal(err)
					}
					actual, readErr = io.ReadAll(f)
					f.Close()
					if readErr != nil || !bytes.Equal(actual, want.state) {
						t.Fatalf("%s state bytes crossed source boundary: %x %v", game.Source, actual, readErr)
					}
					slots[game.Source] = slot
				}
				if slots["bundled"].GameID == slots["imported"].GameID || slots["bundled"].ID == slots["imported"].ID || slots["bundled"].SHA256 == slots["imported"].SHA256 {
					t.Fatalf("same-numbered slots were merged: %+v", slots)
				}
				return slots
			}
			before := assertDestination()
			out, err = dest.backup.Restore(ctx, owner, bytes.NewReader(data), int64(len(data)))
			if err != nil || out.ImportedGames != 0 || out.ExistingGames != 2 || out.RestoredSaves != 0 || len(out.Conflicts) != 2 || !out.SettingsRestored {
				t.Fatalf("repeat restore %+v %v", out, err)
			}
			wantConflicts := map[string]bool{sourceSaves["bundled"].ID: true, sourceSaves["imported"].ID: true}
			for _, conflict := range out.Conflicts {
				if conflict.Kind != "save" || !wantConflicts[conflict.ID] || conflict.Message == "" {
					t.Fatalf("missing or duplicate source save conflict: %+v", out.Conflicts)
				}
				delete(wantConflicts, conflict.ID)
			}
			if len(wantConflicts) != 0 {
				t.Fatalf("source save conflicts omitted: %+v", wantConflicts)
			}
			after := assertDestination()
			for kind, slot := range before {
				if after[kind] != slot {
					t.Fatalf("repeat restore changed %s save metadata: before=%+v after=%+v", kind, slot, after[kind])
				}
			}
		})
	}
}

func rewriteArchive(t *testing.T, data []byte, mutate func(map[string][]byte, *Manifest), extra func(*zip.Writer)) []byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{}
	for _, f := range zr.File {
		r, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, err := io.ReadAll(r)
		r.Close()
		if err != nil {
			t.Fatal(err)
		}
		files[f.Name] = b
	}
	var m Manifest
	if json.Unmarshal(files["manifest.json"], &m) != nil {
		t.Fatal("manifest")
	}
	if mutate != nil {
		mutate(files, &m)
	}
	files["manifest.json"], err = json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	var b bytes.Buffer
	zw := zip.NewWriter(&b)
	for name, value := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = w.Write(value); err != nil {
			t.Fatal(err)
		}
	}
	if extra != nil {
		extra(zw)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func TestRestoreRejectsMalformedArchiveBeforeWriting(t *testing.T) {
	source := backend(t)
	seed(t, source, owner)
	data := exported(t, source, owner)
	cases := map[string][]byte{}
	cases["hash mismatch"] = rewriteArchive(t, data, func(files map[string][]byte, m *Manifest) { files[m.Saves[0].Member][0] ^= 0xff }, nil)
	cases["duplicate game IDs"] = rewriteArchive(t, data, func(files map[string][]byte, m *Manifest) { m.Games = append(m.Games, m.Games[0]) }, nil)
	cases["wrong ROM association"] = rewriteArchive(t, data, func(files map[string][]byte, m *Manifest) { m.Saves[0].ROMSHA256 = strings.Repeat("0", 64) }, nil)
	cases["duplicate slot"] = rewriteArchive(t, data, func(files map[string][]byte, m *Manifest) {
		m.Saves[1].Kind = m.Saves[0].Kind
		m.Saves[1].Slot = m.Saves[0].Slot
	}, nil)
	cases["traversal"] = rewriteArchive(t, data, nil, func(zw *zip.Writer) { w, _ := zw.Create("../outside"); w.Write([]byte("secret")) })
	cases["absolute"] = rewriteArchive(t, data, nil, func(zw *zip.Writer) { w, _ := zw.Create("/etc/overwrite"); w.Write([]byte("secret")) })
	cases["backslash"] = rewriteArchive(t, data, nil, func(zw *zip.Writer) { w, _ := zw.Create(`roms\escape`); w.Write([]byte("secret")) })
	cases["duplicate ZIP name"] = rewriteArchive(t, data, nil, func(zw *zip.Writer) { w, _ := zw.Create("settings.json"); w.Write([]byte("{}")) })
	cases["symlink"] = rewriteArchive(t, data, nil, func(zw *zip.Writer) {
		h := &zip.FileHeader{Name: "link"}
		h.SetMode(os.ModeSymlink | 0777)
		w, _ := zw.CreateHeader(h)
		w.Write([]byte("/etc/passwd"))
	})
	for name, data := range cases {
		t.Run(name, func(t *testing.T) {
			dest := backend(t)
			out, err := dest.backup.Restore(context.Background(), owner, bytes.NewReader(data), int64(len(data)))
			if err == nil || out.ImportedGames != 0 || out.RestoredSaves != 0 {
				t.Fatalf("invalid accepted %+v %v", out, err)
			}
			games, err := dest.lib.List(context.Background(), owner)
			if err != nil || len(games) != 0 {
				t.Fatal("invalid backup wrote games")
			}
			settings, err := dest.st.Settings(context.Background(), owner)
			if err != nil || settings != "{}" {
				t.Fatal("invalid backup wrote settings")
			}
		})
	}
	if _, err := validate(context.Background(), bytes.NewReader(data), MaxArchiveBytes+1); !errors.Is(err, ErrLimit) {
		t.Fatalf("archive size not bounded %v", err)
	}
	var b bytes.Buffer
	zw := zip.NewWriter(&b)
	for i := 0; i < MaxMembers+1; i++ {
		w, _ := zw.Create(filepath.Join("many", strings.Repeat("a", i%10)+store.NewID()))
		w.Write([]byte("x"))
	}
	zw.Close()
	if _, err := validate(context.Background(), bytes.NewReader(b.Bytes()), int64(b.Len())); !errors.Is(err, ErrLimit) {
		t.Fatalf("member count not bounded %v", err)
	}
}

func TestSettingsConflictPreservesExistingAndAddsMissing(t *testing.T) {
	source := backend(t)
	seed(t, source, owner)
	data := exported(t, source, owner)
	dest := backend(t)
	if err := dest.st.SetSettings(context.Background(), owner, `{"volume":0.9,"localOnly":true}`); err != nil {
		t.Fatal(err)
	}
	out, err := dest.backup.Restore(context.Background(), owner, bytes.NewReader(data), int64(len(data)))
	if err != nil || out.SettingsRestored {
		t.Fatalf("settings restore %+v %v", out, err)
	}
	value, err := dest.st.Settings(context.Background(), owner)
	if err != nil || !strings.Contains(value, `"volume":0.9`) || !strings.Contains(value, `"localOnly":true`) || !strings.Contains(value, `"language":"zh-CN"`) {
		t.Fatalf("settings lost %s %v", value, err)
	}
	found := false
	for _, c := range out.Conflicts {
		if c.Kind == "settings" && c.ID == "settings" {
			found = true
		}
	}
	if !found {
		t.Fatalf("settings conflict missing %+v", out)
	}
}

type cancellingLibrary struct {
	Library
	cancel context.CancelFunc
}

func (l cancellingLibrary) Import(ctx context.Context, u fnos.User, in []library.Upload) ([]store.Game, error) {
	g, err := l.Library.Import(ctx, u, in)
	l.cancel()
	return g, err
}
func TestCancellationKeepsCommittedAdditionsAndRetryCompletes(t *testing.T) {
	source := backend(t)
	seed(t, source, owner)
	data := exported(t, source, owner)
	dest := backend(t)
	ctx, cancel := context.WithCancel(context.Background())
	service := New(dest.st, cancellingLibrary{dest.lib, cancel}, dest.sv)
	out, err := service.Restore(ctx, owner, bytes.NewReader(data), int64(len(data)))
	if !errors.Is(err, context.Canceled) || out.ImportedGames != 1 || out.RestoredSaves != 0 {
		t.Fatalf("cancel %+v %v", out, err)
	}
	games, err := dest.lib.List(context.Background(), owner)
	if err != nil || len(games) != 1 {
		t.Fatal("committed addition lost")
	}
	out, err = dest.backup.Restore(context.Background(), owner, bytes.NewReader(data), int64(len(data)))
	if err != nil || out.ImportedGames != 0 || out.ExistingGames != 1 || out.RestoredSaves != 2 {
		t.Fatalf("retry %+v %v", out, err)
	}
	cancelled, stop := context.WithCancel(context.Background())
	stop()
	var b bytes.Buffer
	if err = source.backup.Export(cancelled, owner, &b); !errors.Is(err, context.Canceled) || b.Len() != 0 {
		t.Fatalf("cancelled export %v bytes=%d", err, b.Len())
	}
	if _, err = dest.backup.Restore(cancelled, owner, bytes.NewReader(data), int64(len(data))); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled restore %v", err)
	}
}
