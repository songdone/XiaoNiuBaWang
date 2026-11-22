package library

import (
	"context"
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
	if len(uploads) == 0 || len(uploads) > MaxUploads {
		return nil, store.ErrInvalid
	}
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
		if !SafeFilename(up.Filename) {
			return nil, store.ErrInvalid
		}
		if !strings.EqualFold(filepath.Ext(up.Filename), ".nes") {
			return nil, ErrInvalidROM
		}
		title := up.Title
		if title == "" {
			title = strings.TrimSuffix(up.Filename, filepath.Ext(up.Filename))
		}
		title, err := cleanTitle(title)
		if err != nil {
			return nil, err
		}
		blob, err := s.store.WriteBlob(ctx, user, "rom", up.Reader, MaxROMSize)
		if err != nil {
			return nil, err
		}
		g := store.Game{ID: store.NewID(), Title: title, Filename: up.Filename,
			SHA256: blob.SHA256, Size: blob.Size, BlobKey: blob.Key}
		pending = append(pending, g)
		f, err := s.store.OpenBlob(ctx, user, blob)
		if err != nil {
			return nil, err
		}
		h, err := parseROM(f, blob.Size)
		_ = f.Close()
		if err != nil {
			return nil, err
		}
		pending[len(pending)-1].Mapper = h.Mapper
		pending[len(pending)-1].Format = h.Format
	}
	s.store.BlobsMu.Lock()
	defer s.store.BlobsMu.Unlock()
	out, err := s.store.CommitGames(ctx, user, pending)
	if err != nil {
		return nil, err
	}
	for _, g := range out {
		kept[g.BlobKey] = true
	}
	return out, nil
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
