package backup

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"strconv"
	"time"

	"xiaoniubawang/internal/fnos"
)

// Export writes a bounded self-contained ZIP, verifying the exact opened ROM and
// save bytes against their metadata. Archive IDs are references, never paths to
// app storage. Bundled ROMs stay in the catalog and are matched by digest later.
func (s *Service) Export(ctx context.Context, user fnos.User, w io.Writer) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	games, err := s.library.List(ctx, user)
	if err != nil {
		return err
	}
	settings, err := s.settings.Settings(ctx, user)
	if err != nil {
		return err
	}
	if _, err = object([]byte(settings)); err != nil {
		return err
	}
	manifest := Manifest{Schema: Schema, Version: Version, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Settings: "settings.json", Games: []Game{}, Saves: []Save{}, Members: []Member{}}
	zw := zip.NewWriter(w)
	var total int64
	write := func(name string, size int64, digest string, r io.Reader) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if size <= 0 || size > MaxTotalBytes-total || len(manifest.Members)+2 > MaxMembers {
			return ErrLimit
		}
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		header.SetMode(0600)
		entry, err := zw.CreateHeader(header)
		if err != nil {
			return err
		}
		h := sha256.New()
		n, err := io.Copy(io.MultiWriter(entry, h), io.LimitReader(cancelReader{ctx, r}, size+1))
		if err != nil {
			return err
		}
		actual := hex.EncodeToString(h.Sum(nil))
		if n != size || digest != "" && digest != actual {
			return ErrInvalid
		}
		total += n
		manifest.Members = append(manifest.Members, Member{name, n, actual})
		return nil
	}
	if err := write("settings.json", int64(len(settings)), "", bytes.NewBufferString(settings)); err != nil {
		return err
	}
	roms := map[string]string{}
	for _, g := range games {
		if err := ctx.Err(); err != nil {
			return err
		}
		out := Game{ID: g.ID, Title: g.Title, Filename: g.Filename, SHA256: g.SHA256, Size: g.Size, Source: g.Source, Favorite: g.Favorite, LastPlayedAt: g.LastPlayedAt, PlayCount: g.PlayCount}
		if g.Source == "imported" {
			member, exists := roms[g.SHA256]
			if !exists {
				member = "roms/" + g.SHA256 + ".nes"
				actual, f, e := s.library.Open(ctx, user, g.ID)
				if e != nil {
					return e
				}
				if actual.SHA256 != g.SHA256 || actual.Size != g.Size {
					f.Close()
					return ErrInvalid
				}
				e = write(member, g.Size, g.SHA256, f)
				f.Close()
				if e != nil {
					return e
				}
				roms[g.SHA256] = member
			}
			out.Member = member
		}
		manifest.Games = append(manifest.Games, out)
		slots, err := s.saves.List(ctx, user, g.ID)
		if err != nil {
			return err
		}
		for _, slot := range slots {
			if slot.GameID != g.ID || slot.ROMSHA256 != g.SHA256 {
				return ErrInvalid
			}
			actual, f, e := s.saves.Open(ctx, user, slot.ID)
			if e != nil {
				return e
			}
			if actual.SHA256 != slot.SHA256 || actual.Size != slot.Size || actual.GameID != slot.GameID || actual.Kind != slot.Kind || actual.Slot != slot.Slot || actual.Core != slot.Core || actual.CoreVersion != slot.CoreVersion || actual.ROMSHA256 != slot.ROMSHA256 {
				f.Close()
				return ErrInvalid
			}
			member := "saves/" + strconv.Itoa(len(manifest.Saves)) + ".bin"
			e = write(member, slot.Size, slot.SHA256, f)
			f.Close()
			if e != nil {
				return e
			}
			manifest.Saves = append(manifest.Saves, Save{ID: slot.ID, GameID: slot.GameID, Kind: slot.Kind, Slot: slot.Slot, Core: slot.Core, CoreVersion: slot.CoreVersion, ROMSHA256: slot.ROMSHA256, SHA256: slot.SHA256, Size: slot.Size, Member: member})
		}
	}
	b, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	if int64(len(b)) > MaxManifestBytes || total+int64(len(b)) > MaxTotalBytes || len(manifest.Members)+1 > MaxMembers {
		return ErrLimit
	}
	entry, err := zw.CreateHeader(&zip.FileHeader{Name: "manifest.json", Method: zip.Deflate})
	if err != nil {
		return err
	}
	if _, err = io.Copy(entry, cancelReader{ctx, bytes.NewReader(b)}); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return zw.Close()
}

// ExportBytes bounds the response before headers are committed, so an invalid
// source blob produces an error instead of a successful truncated download.
func (s *Service) ExportBytes(ctx context.Context, user fnos.User) ([]byte, error) {
	var b bytes.Buffer
	w := &limitedWriter{w: &b, remaining: MaxArchiveBytes}
	if err := s.Export(ctx, user, w); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

type limitedWriter struct {
	w         io.Writer
	remaining int64
}

func (w *limitedWriter) Write(p []byte) (int, error) {
	if int64(len(p)) > w.remaining {
		return 0, ErrLimit
	}
	n, err := w.w.Write(p)
	w.remaining -= int64(n)
	return n, err
}
