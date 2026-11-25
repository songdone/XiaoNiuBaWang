package library

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"xiaoniubawang/internal/fnos"
	"xiaoniubawang/internal/store"
)

type Service struct {
	store   *store.Store
	bundled *os.Root
}

func New(ctx context.Context, st *store.Store, bundledRoot string) (*Service, error) {
	s := &Service{store: st}
	if bundledRoot != "" {
		root, err := os.OpenRoot(bundledRoot)
		if err != nil {
			return nil, err
		}
		s.bundled = root
	}
	if err := s.loadBundled(ctx); err != nil {
		_ = s.Close()
		return nil, err
	}
	return s, nil
}

func (s *Service) Close() error {
	if s.bundled != nil {
		return s.bundled.Close()
	}
	return nil
}

type Upload struct {
	Filename string
	Title    string
	Reader   io.Reader
}

func (s *Service) Import(ctx context.Context, user fnos.User, uploads []Upload) ([]store.Game, error) {
	games, _, _, err := s.ImportDetailed(ctx, user, uploads)
	return games, err
}

func (s *Service) ImportDetailed(ctx context.Context, user fnos.User, uploads []Upload) ([]store.Game, int, int, error) {
	if len(uploads) == 0 || len(uploads) > MaxUploads {
		return nil, 0, 0, store.ErrInvalid
	}
	type slotEntry struct {
		existing *store.Game
		pending  int
	}
	order := make([]slotEntry, 0, len(uploads))
	pending := make([]store.Game, 0, len(uploads))
	kept := make(map[string]bool)
	defer func() {
		for _, g := range pending {
			if !kept[g.BlobKey] {
				_ = s.store.RemoveBlob(user, g.BlobKey)
			}
		}
	}()
	for _, up := range uploads {
		if err := ctx.Err(); err != nil {
			return nil, 0, 0, err
		}
		if !SafeFilename(up.Filename) || up.Reader == nil {
			return nil, 0, 0, store.ErrInvalid
		}
		filename := up.Filename
		reader := up.Reader
		ext := strings.ToLower(filepath.Ext(filename))
		switch ext {
		case ".nes":
		case ".zip":
			extractedName, data, err := ExtractSingleROMFromZip(reader)
			if err != nil {
				return nil, 0, 0, err
			}
			filename = extractedName
			reader = bytes.NewReader(data)
		default:
			return nil, 0, 0, ErrInvalidROM
		}
		title := up.Title
		if title == "" {
			title = strings.TrimSuffix(filename, filepath.Ext(filename))
		}
		title, err := cleanTitle(title)
		if err != nil {
			return nil, 0, 0, err
		}
		var hdrBytes [16]byte
		if _, err := io.ReadFull(reader, hdrBytes[:]); err != nil {
			if ctx.Err() != nil {
				return nil, 0, 0, ctx.Err()
			}
			return nil, 0, 0, ErrInvalidROM
		}
		h, err := parseROMHeader(hdrBytes)
		if err != nil {
			return nil, 0, 0, err
		}
		if rs, ok := reader.(io.ReadSeeker); ok {
			sum := sha256.New()
			_, _ = sum.Write(hdrBytes[:])
			rest, err := io.Copy(sum, io.LimitReader(reader, MaxROMSize-int64(len(hdrBytes))+1))
			if err != nil {
				return nil, 0, 0, err
			}
			totalSize := int64(len(hdrBytes)) + rest
			if totalSize > MaxROMSize {
				return nil, 0, 0, store.ErrTooLarge
			}
			if h.MinSize > uint64(totalSize) {
				return nil, 0, 0, ErrInvalidROM
			}
			digest := hex.EncodeToString(sum.Sum(nil))
			if existing, found, err := s.store.HasGameBySHA256(ctx, user, digest); err != nil {
				return nil, 0, 0, err
			} else if found {
				copyGame := existing
				order = append(order, slotEntry{existing: &copyGame, pending: -1})
				continue
			}
			if _, err := rs.Seek(0, io.SeekStart); err != nil {
				return nil, 0, 0, err
			}
			blob, err := s.store.WriteBlob(ctx, user, "rom", rs, MaxROMSize)
			if err != nil {
				return nil, 0, 0, err
			}
			if blob.Size != totalSize || blob.SHA256 != digest {
				_ = s.store.RemoveBlob(user, blob.Key)
				return nil, 0, 0, store.ErrCorrupt
			}
			g := store.Game{ID: store.NewID(), Title: title, Filename: filename,
				SHA256: blob.SHA256, Size: blob.Size, Mapper: h.Mapper, Format: h.Format, BlobKey: blob.Key}
			order = append(order, slotEntry{pending: len(pending)})
			pending = append(pending, g)
			continue
		}
		combined := io.MultiReader(bytes.NewReader(hdrBytes[:]), reader)
		blob, err := s.store.WriteBlob(ctx, user, "rom", combined, MaxROMSize)
		if err != nil {
			return nil, 0, 0, err
		}
		g := store.Game{ID: store.NewID(), Title: title, Filename: filename,
			SHA256: blob.SHA256, Size: blob.Size, Mapper: h.Mapper, Format: h.Format, BlobKey: blob.Key}
		order = append(order, slotEntry{pending: len(pending)})
		pending = append(pending, g)
		if h.MinSize > uint64(blob.Size) {
			return nil, 0, 0, ErrInvalidROM
		}
	}
	var committed []store.Game
	created, skipped := 0, 0
	if len(pending) > 0 {
		s.store.BlobsMu.Lock()
		var err error
		committed, created, skipped, err = s.store.CommitGamesDetailed(ctx, user, pending)
		s.store.BlobsMu.Unlock()
		if err != nil {
			return nil, 0, 0, err
		}
		for _, g := range committed {
			kept[g.BlobKey] = true
		}
	}
	out := make([]store.Game, 0, len(order))
	for _, entry := range order {
		if entry.existing != nil {
			out = append(out, *entry.existing)
			skipped++
		} else {
			out = append(out, committed[entry.pending])
		}
	}
	return out, created, skipped, nil
}

func (s *Service) List(ctx context.Context, user fnos.User) ([]store.Game, error) {
	return s.store.ListGames(ctx, user)
}

func (s *Service) Query(ctx context.Context, user fnos.User, query store.GameQuery) (store.GamePage, error) {
	return s.store.QueryGames(ctx, user, query)
}

func (s *Service) Get(ctx context.Context, user fnos.User, id string) (store.Game, error) {
	return s.store.Game(ctx, user, id)
}

func (s *Service) Favorite(ctx context.Context, user fnos.User, id string, value bool) (store.Game, error) {
	return s.store.Favorite(ctx, user, id, value)
}

func (s *Service) Rename(ctx context.Context, user fnos.User, id, title string) (store.Game, error) {
	title, err := cleanTitle(title)
	if err != nil {
		return store.Game{}, err
	}
	return s.store.RenameGame(ctx, user, id, title)
}

func (s *Service) Delete(ctx context.Context, user fnos.User, id string) error {
	s.store.BlobsMu.Lock()
	defer s.store.BlobsMu.Unlock()
	keys, err := s.store.DeleteGame(ctx, user, id)
	if err != nil {
		return err
	}
	for _, key := range keys {
		_ = s.store.RemoveBlob(user, key)
	}
	return nil
}

func (s *Service) Launch(ctx context.Context, user fnos.User, id string) (store.Game, error) {
	g, f, err := s.Open(ctx, user, id)
	if err != nil {
		return store.Game{}, err
	}
	if err := f.Close(); err != nil {
		return store.Game{}, err
	}
	return s.store.Launched(ctx, user, g.ID)
}

func (s *Service) Open(ctx context.Context, user fnos.User, id string) (store.Game, *os.File, error) {
	s.store.BlobsMu.RLock()
	defer s.store.BlobsMu.RUnlock()
	g, err := s.store.Game(ctx, user, id)
	if err != nil {
		return store.Game{}, nil, err
	}
	if g.Source == "bundled" {
		f, err := s.openBundled(g.BlobKey)
		if err == nil {
			if err = store.VerifyBlob(ctx, f, g.Blob()); err != nil {
				_ = f.Close()
			}
		}
		if err != nil {
			return store.Game{}, nil, errors.Join(store.ErrCorrupt, err)
		}
		return g, f, nil
	}
	f, err := s.store.OpenBlob(ctx, user, g.Blob())
	if err != nil {
		return store.Game{}, nil, errors.Join(store.ErrCorrupt, err)
	}
	return g, f, nil
}

const MaxCoverSize = 2 << 20

var ErrInvalidCover = errors.New("invalid cover image")

func detectCoverImageType(header []byte) string {
	switch {
	case len(header) >= 8 && bytes.Equal(header[:8], []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}):
		return "image/png"
	case len(header) >= 3 && header[0] == 0xff && header[1] == 0xd8 && header[2] == 0xff:
		return "image/jpeg"
	case len(header) >= 12 && bytes.Equal(header[:4], []byte("RIFF")) && bytes.Equal(header[8:12], []byte("WEBP")):
		return "image/webp"
	default:
		return ""
	}
}

func (s *Service) SetCover(ctx context.Context, user fnos.User, id string, data []byte) (store.Game, error) {
	if len(data) == 0 {
		return store.Game{}, ErrInvalidCover
	}
	if len(data) > MaxCoverSize {
		return store.Game{}, store.ErrTooLarge
	}
	contentType := detectCoverImageType(data)
	if contentType == "" {
		return store.Game{}, ErrInvalidCover
	}
	g, err := s.store.Game(ctx, user, id)
	if err != nil {
		return store.Game{}, err
	}
	if g.Source == "bundled" {
		return store.Game{}, store.ErrReadOnly
	}
	blob, err := s.store.WriteBlob(ctx, user, "cover", bytes.NewReader(data), MaxCoverSize)
	if err != nil {
		return store.Game{}, err
	}
	s.store.BlobsMu.Lock()
	updated, previous, err := s.store.SetCover(ctx, user, id, blob, contentType)
	s.store.BlobsMu.Unlock()
	if err != nil {
		_ = s.store.RemoveBlob(user, blob.Key)
		return store.Game{}, err
	}
	if previous != "" && previous != blob.Key {
		_ = s.store.RemoveBlob(user, previous)
	}
	return updated, nil
}

func (s *Service) OpenCustomCover(ctx context.Context, user fnos.User, id string) (store.CoverRecord, *os.File, error) {
	s.store.BlobsMu.RLock()
	defer s.store.BlobsMu.RUnlock()
	rec, err := s.store.GetCover(ctx, user, id)
	if err != nil {
		return store.CoverRecord{}, nil, err
	}
	f, err := s.store.OpenBlob(ctx, user, rec.Blob)
	if err != nil {
		return store.CoverRecord{}, nil, errors.Join(store.ErrCorrupt, err)
	}
	return rec, f, nil
}

func (s *Service) DeleteCover(ctx context.Context, user fnos.User, id string) (store.Game, error) {
	s.store.BlobsMu.Lock()
	updated, previous, err := s.store.DeleteCover(ctx, user, id)
	s.store.BlobsMu.Unlock()
	if err != nil {
		return store.Game{}, err
	}
	if previous != "" {
		_ = s.store.RemoveBlob(user, previous)
	}
	return updated, nil
}
