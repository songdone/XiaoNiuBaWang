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
	"strconv"
	"time"

	"xiaoniubawang/internal/fnos"
	"xiaoniubawang/internal/store"
)

// Export writes a bounded self-contained ZIP, verifying the exact opened ROM and
// save bytes against their metadata. Archive IDs are references, never paths to
// app storage. Bundled ROMs stay in the catalog and are matched by digest later.
func (s *Service) Export(ctx context.Context, user fnos.User, w io.Writer) error {
	return s.ExportWithOptions(ctx, user, w, ExportOptions{IncludeROMs: true})
}

// ExportWithOptions writes either a full backup (with imported ROM payloads) or
// a lightweight saves/settings/activity backup (IncludeROMs=false).
func (s *Service) ExportWithOptions(ctx context.Context, user fnos.User, w io.Writer, opts ExportOptions) error {
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
	covers, _ := s.library.(coverAccess)
	thumbs, _ := s.saves.(thumbAccess)
	roms := map[string]string{}
	for _, g := range games {
		if err := ctx.Err(); err != nil {
			return err
		}
		out := Game{ID: g.ID, Title: g.Title, Filename: g.Filename, SHA256: g.SHA256, Size: g.Size, Source: g.Source, Favorite: g.Favorite, LastPlayedAt: g.LastPlayedAt, PlayCount: g.PlayCount}
		if g.Source == "imported" && opts.IncludeROMs {
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
		if g.Source == "imported" && covers != nil {
			rec, cf, ce := covers.OpenCustomCover(ctx, user, g.ID)
			if ce == nil {
				coverMember := "covers/" + g.ID + ".bin"
				we := write(coverMember, rec.Blob.Size, rec.Blob.SHA256, cf)
				_ = cf.Close()
				if we != nil {
					return we
				}
				out.CoverMember = coverMember
			} else if !errors.Is(ce, store.ErrNotFound) {
				return ce
			}
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
			idxStr := strconv.Itoa(len(manifest.Saves))
			member := "saves/" + idxStr + ".bin"
			e = write(member, slot.Size, slot.SHA256, f)
			f.Close()
			if e != nil {
				return e
			}
			var thumbMember string
			if thumbs != nil {
				trec, tf, te := thumbs.OpenThumb(ctx, user, slot.ID)
				if te == nil {
					thumbMember = "thumbs/" + idxStr + ".bin"
					we := write(thumbMember, trec.Blob.Size, trec.Blob.SHA256, tf)
					_ = tf.Close()
					if we != nil {
						return we
					}
				} else if !errors.Is(te, store.ErrNotFound) {
					return te
				}
			}
			manifest.Saves = append(manifest.Saves, Save{ID: slot.ID, GameID: slot.GameID, Kind: slot.Kind, Slot: slot.Slot, Core: slot.Core, CoreVersion: slot.CoreVersion, ROMSHA256: slot.ROMSHA256, SHA256: slot.SHA256, Size: slot.Size, Member: member, ThumbMember: thumbMember})
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

// ExportToFile spools the validated ZIP into a private 0600 temp file under
// $TMPDIR so large exports do not hold hundreds of megabytes in RAM.
func (s *Service) ExportToFile(ctx context.Context, user fnos.User, opts ExportOptions) (*os.File, int64, error) {
	f, err := os.CreateTemp("", "xnbw-backup-*.zip")
	if err != nil {
		return nil, 0, err
	}
	cleanup := func() {
		name := f.Name()
		_ = f.Close()
		_ = os.Remove(name)
	}
	if err := f.Chmod(0600); err != nil {
		cleanup()
		return nil, 0, err
	}
	w := &limitedWriter{w: f, remaining: MaxArchiveBytes}
	if err := s.ExportWithOptions(ctx, user, w, opts); err != nil {
		cleanup()
		return nil, 0, err
	}
	info, err := f.Stat()
	if err != nil {
		cleanup()
		return nil, 0, err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		cleanup()
		return nil, 0, err
	}
	return f, info.Size(), nil
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
