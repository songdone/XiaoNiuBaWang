package backup

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"path"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"xiaoniubawang/internal/library"
	"xiaoniubawang/internal/saves"
	"xiaoniubawang/internal/store"
)

type validated struct {
	manifest Manifest
	files    map[string]*zip.File
	declared map[string]Member
	settings map[string]json.RawMessage
}

func (v *validated) openMember(ctx context.Context, name string) (io.ReadCloser, error) {
	f := v.files[name]
	entry, ok := v.declared[name]
	if f == nil || !ok {
		return nil, ErrInvalid
	}
	rc, err := f.Open()
	if err != nil {
		return nil, ErrInvalid
	}
	return &boundedReadCloser{r: io.LimitReader(cancelReader{ctx, rc}, entry.Size), c: rc}, nil
}

type boundedReadCloser struct {
	r io.Reader
	c io.Closer
}

func (b *boundedReadCloser) Read(p []byte) (int, error) { return b.r.Read(p) }
func (b *boundedReadCloser) Close() error               { return b.c.Close() }

func verifyMemberStream(ctx context.Context, f *zip.File, entry Member, checkNESMagic bool) error {
	if f.UncompressedSize64 != uint64(entry.Size) {
		return ErrInvalid
	}
	rc, err := f.Open()
	if err != nil {
		return ErrInvalid
	}
	defer rc.Close()
	r := io.LimitReader(cancelReader{ctx, rc}, entry.Size+1)
	h := sha256.New()
	var written int64
	if checkNESMagic {
		var hdr [16]byte
		n, err := io.ReadFull(r, hdr[:])
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return ErrInvalid
		}
		if string(hdr[:4]) != "NES\x1a" {
			return ErrInvalid
		}
		_, _ = h.Write(hdr[:n])
		written += int64(n)
	}
	n, err := io.Copy(h, r)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return ErrInvalid
	}
	written += n
	if written != entry.Size {
		if written > entry.Size {
			return ErrLimit
		}
		return ErrInvalid
	}
	if hex.EncodeToString(h.Sum(nil)) != entry.SHA256 {
		return ErrInvalid
	}
	return nil
}

func memberName(name string) bool {
	if name == "" || len(name) > 256 || strings.ContainsAny(name, "\\:\x00") || !utf8.ValidString(name) || path.IsAbs(name) || path.Clean(name) != name {
		return false
	}
	for _, c := range strings.Split(name, "/") {
		if c == "" || c == "." || c == ".." {
			return false
		}
	}
	return true
}
func token(value string) bool {
	return value != "" && len(value) <= 96 && strings.IndexFunc(value, func(c rune) bool {
		return !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || strings.ContainsRune("._+-", c))
	}) < 0
}
func strictJSON(b []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if d.Decode(v) != nil {
		return ErrInvalid
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return ErrInvalid
	}
	return nil
}
func readMember(ctx context.Context, f *zip.File, limit int64) ([]byte, error) {
	if f.UncompressedSize64 > uint64(limit) {
		return nil, ErrLimit
	}
	r, err := f.Open()
	if err != nil {
		return nil, ErrInvalid
	}
	defer r.Close()
	b, err := io.ReadAll(io.LimitReader(cancelReader{ctx, r}, limit+1))
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, ErrInvalid
	}
	if int64(len(b)) > limit {
		return nil, ErrLimit
	}
	if uint64(len(b)) != f.UncompressedSize64 {
		return nil, ErrInvalid
	}
	return b, nil
}

// validate completes before the first import, settings write or save creation.
// ZIP member names are never extracted to the filesystem.
func validate(ctx context.Context, r io.ReaderAt, size int64) (validated, error) {
	out := validated{}
	if err := ctx.Err(); err != nil {
		return out, err
	}
	if size <= 0 || size > MaxArchiveBytes {
		return out, ErrLimit
	}
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return out, ErrInvalid
	}
	if len(zr.File) == 0 || len(zr.File) > MaxMembers {
		return out, ErrLimit
	}
	files := map[string]*zip.File{}
	var total uint64
	for _, f := range zr.File {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		if !memberName(f.Name) || files[f.Name] != nil || !f.Mode().IsRegular() || f.Flags&1 != 0 {
			return out, ErrInvalid
		}
		if f.UncompressedSize64 > uint64(MaxTotalBytes)-total {
			return out, ErrLimit
		}
		total += f.UncompressedSize64
		files[f.Name] = f
	}
	mf := files["manifest.json"]
	if mf == nil {
		return out, ErrInvalid
	}
	b, err := readMember(ctx, mf, MaxManifestBytes)
	if err != nil {
		return out, err
	}
	if strictJSON(b, &out.manifest) != nil {
		return out, ErrInvalid
	}
	m := out.manifest
	if m.Schema != Schema || m.Version != Version || m.Settings != "settings.json" || len(m.Members)+1 != len(files) || len(m.Games) > MaxMembers || len(m.Saves) > MaxMembers {
		return out, ErrInvalid
	}
	if _, err := time.Parse(time.RFC3339Nano, m.CreatedAt); err != nil {
		return out, ErrInvalid
	}
	declared := map[string]Member{}
	for _, entry := range m.Members {
		if !memberName(entry.Path) || entry.Path == "manifest.json" || entry.Size <= 0 || entry.Size > MaxTotalBytes || !store.IsSHA256(entry.SHA256) {
			return out, ErrInvalid
		}
		if _, exists := declared[entry.Path]; exists {
			return out, ErrInvalid
		}
		f := files[entry.Path]
		if f == nil || uint64(entry.Size) != f.UncompressedSize64 {
			return out, ErrInvalid
		}
		declared[entry.Path] = entry
	}
	refs := map[string]bool{"settings.json": true}
	games := map[string]Game{}
	ids := map[string]bool{}
	slots := map[string]bool{}
	settings, ok := declared["settings.json"]
	if !ok || settings.Size > MaxSettingsBytes {
		return out, ErrInvalid
	}
	for _, g := range m.Games {
		if !store.ValidID(g.ID) || ids[g.ID] || !store.IsSHA256(g.SHA256) || g.Size <= 0 || g.Size > library.MaxROMSize || !library.SafeFilename(g.Filename) || !strings.EqualFold(path.Ext(g.Filename), ".nes") || g.Title == "" || len(g.Title) > 256 || !utf8.ValidString(g.Title) || strings.ContainsFunc(g.Title, unicode.IsControl) || g.PlayCount < 0 {
			return out, ErrInvalid
		}
		if g.LastPlayedAt != "" {
			if _, err := time.Parse(time.RFC3339Nano, g.LastPlayedAt); err != nil {
				return out, ErrInvalid
			}
		}
		switch g.Source {
		case "imported":
			if g.Member != "" {
				if g.Member != "roms/"+g.SHA256+".nes" {
					return out, ErrInvalid
				}
				entry, exists := declared[g.Member]
				if !exists || entry.Size != g.Size || entry.SHA256 != g.SHA256 {
					return out, ErrInvalid
				}
				refs[g.Member] = true
			}
			if g.CoverMember != "" {
				if g.CoverMember != "covers/"+g.ID+".bin" {
					return out, ErrInvalid
				}
				entry, exists := declared[g.CoverMember]
				if !exists || entry.Size <= 0 || entry.Size > library.MaxCoverSize {
					return out, ErrInvalid
				}
				refs[g.CoverMember] = true
			}
		case "bundled":
			if g.Member != "" || g.CoverMember != "" {
				return out, ErrInvalid
			}
		default:
			return out, ErrInvalid
		}
		games[g.ID] = g
		ids[g.ID] = true
	}
	for i, sv := range m.Saves {
		g, ok := games[sv.GameID]
		if !ok || !store.ValidID(sv.ID) || ids[sv.ID] || sv.ROMSHA256 != g.SHA256 || !store.IsSHA256(sv.SHA256) || !token(sv.Core) || !token(sv.CoreVersion) || sv.Size <= 0 || sv.Slot < 0 || sv.Slot > 99 {
			return out, ErrInvalid
		}
		limit := saves.MaxState
		if sv.Kind == "sram" {
			limit = saves.MaxSRAM
			if sv.Slot != 0 {
				return out, ErrInvalid
			}
		} else if sv.Kind != "state" {
			return out, ErrInvalid
		}
		if sv.Size > limit || sv.Member != "saves/"+strconv.Itoa(i)+".bin" {
			return out, ErrInvalid
		}
		entry, exists := declared[sv.Member]
		if !exists || entry.Size != sv.Size || entry.SHA256 != sv.SHA256 {
			return out, ErrInvalid
		}
		key := sv.GameID + ":" + sv.Kind + ":" + strconv.Itoa(sv.Slot)
		if slots[key] {
			return out, ErrInvalid
		}
		slots[key] = true
		ids[sv.ID] = true
		refs[sv.Member] = true
		if sv.ThumbMember != "" {
			if sv.ThumbMember != "thumbs/"+strconv.Itoa(i)+".bin" {
				return out, ErrInvalid
			}
			tEntry, exists := declared[sv.ThumbMember]
			if !exists || tEntry.Size <= 0 || tEntry.Size > saves.MaxThumbSize {
				return out, ErrInvalid
			}
			refs[sv.ThumbMember] = true
		}
	}
	if len(refs) != len(declared) {
		return out, ErrInvalid
	}
	for name, entry := range declared {
		if !refs[name] {
			return out, ErrInvalid
		}
		if name == m.Settings {
			b, err := readMember(ctx, files[name], entry.Size)
			if err != nil {
				return out, err
			}
			h := sha256.Sum256(b)
			if hex.EncodeToString(h[:]) != entry.SHA256 {
				return out, ErrInvalid
			}
			out.settings, err = object(b)
			if err != nil {
				return out, err
			}
			continue
		}
		if err := verifyMemberStream(ctx, files[name], entry, strings.HasPrefix(name, "roms/")); err != nil {
			return out, err
		}
	}
	out.files = files
	out.declared = declared
	return out, nil
}
