// Package saves coordinates durable SRAM and emulator-state slots.
package saves

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"strings"

	"xiaoniubawang/internal/fnos"
	"xiaoniubawang/internal/library"
	"xiaoniubawang/internal/store"
)

const (
	MaxSRAM      = int64(1 << 20)
	MaxState     = int64(16 << 20)
	MaxThumbSize = int64(256 << 10)
)

var ErrInvalidThumb = errors.New("invalid save thumbnail image")

func detectThumbImageType(header []byte) string {
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

type Service struct {
	st  *store.Store
	lib *library.Service
}

func New(st *store.Store, lib *library.Service) *Service { return &Service{st, lib} }

type Input struct {
	GameID      string
	Kind        string
	Slot        int
	Core        string
	CoreVersion string
	ROMSHA256   string
	SHA256      string // optional expected digest of the snapshot payload
}

type Assertions struct {
	Core        string
	CoreVersion string
	ROMSHA256   string
	SHA256      string
}

func validCore(s string) bool {
	return s != "" && len(s) <= 96 && strings.IndexFunc(s, func(c rune) bool {
		return !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || strings.ContainsRune("._+-", c))
	}) == -1
}

func maxSize(kind string) int64 {
	if kind == "sram" {
		return MaxSRAM
	}
	return MaxState
}

func (s *Service) List(ctx context.Context, user fnos.User, gameID string) ([]store.Save, error) {
	s.st.BlobsMu.RLock()
	defer s.st.BlobsMu.RUnlock()
	if _, err := s.lib.Get(ctx, user, gameID); err != nil {
		return nil, err
	}
	return s.st.ListSaves(ctx, user, gameID)
}

func (s *Service) Get(ctx context.Context, user fnos.User, id string) (store.Save, error) {
	return s.st.Save(ctx, user, id)
}

func (s *Service) Open(ctx context.Context, user fnos.User, id string) (store.Save, *os.File, error) {
	s.st.BlobsMu.RLock()
	defer s.st.BlobsMu.RUnlock()
	slot, err := s.Get(ctx, user, id)
	if err != nil {
		return store.Save{}, nil, err
	}
	f, err := s.st.OpenBlob(ctx, user, slot.Blob())
	if err != nil {
		return store.Save{}, nil, errors.Join(store.ErrCorrupt, err)
	}
	return slot, f, nil
}

func (s *Service) Create(ctx context.Context, user fnos.User, in Input, r io.Reader) (store.Save, error) {
	if (in.Kind != "sram" && in.Kind != "state") || in.Slot < 0 || in.Slot > 99 || in.Kind == "sram" && in.Slot != 0 ||
		!validCore(in.Core) || !validCore(in.CoreVersion) || !store.IsSHA256(in.ROMSHA256) || in.SHA256 != "" && !store.IsSHA256(in.SHA256) {
		return store.Save{}, store.ErrInvalid
	}
	g, err := s.lib.Get(ctx, user, in.GameID)
	if err != nil {
		return store.Save{}, err
	}
	if g.SHA256 != in.ROMSHA256 {
		return store.Save{}, store.ErrIncompatible
	}
	blob, err := s.st.WriteBlob(ctx, user, "save", r, maxSize(in.Kind))
	if err != nil {
		return store.Save{}, err
	}
	keep := false
	defer func() {
		if !keep {
			_ = s.st.RemoveBlob(user, blob.Key)
		}
	}()
	if in.SHA256 != "" && in.SHA256 != blob.SHA256 {
		return store.Save{}, store.ErrIncompatible
	}
	s.st.BlobsMu.Lock()
	defer s.st.BlobsMu.Unlock()
	v, err := s.st.InsertSave(ctx, user, store.Save{ID: store.NewID(), GameID: g.ID, Kind: in.Kind, Slot: in.Slot,
		Core: in.Core, CoreVersion: in.CoreVersion, ROMSHA256: g.SHA256, SHA256: blob.SHA256, Size: blob.Size, BlobKey: blob.Key})
	keep = err == nil
	return v, err
}

func (s *Service) Update(ctx context.Context, user fnos.User, id, expected string, a Assertions, r io.Reader) (store.Save, error) {
	old, err := s.Get(ctx, user, id)
	if err != nil {
		return store.Save{}, err
	}
	if old.ETag != expected {
		return store.Save{}, &store.SaveConflict{Current: old}
	}
	if a.Core != "" && a.Core != old.Core || a.CoreVersion != "" && a.CoreVersion != old.CoreVersion ||
		a.ROMSHA256 != "" && a.ROMSHA256 != old.ROMSHA256 || a.SHA256 != "" && !store.IsSHA256(a.SHA256) {
		return store.Save{}, store.ErrIncompatible
	}
	blob, err := s.st.WriteBlob(ctx, user, "save", r, maxSize(old.Kind))
	if err != nil {
		return store.Save{}, err
	}
	keep := false
	defer func() {
		if !keep {
			_ = s.st.RemoveBlob(user, blob.Key)
		}
	}()
	if a.SHA256 != "" && a.SHA256 != blob.SHA256 {
		return store.Save{}, store.ErrIncompatible
	}
	s.st.BlobsMu.Lock()
	defer s.st.BlobsMu.Unlock()
	v, prevKey, err := s.st.SwapSave(ctx, user, id, expected, blob)
	if err != nil {
		return store.Save{}, err
	}
	keep = true
	_ = s.st.RemoveBlob(user, prevKey)
	return v, nil
}

func (s *Service) Delete(ctx context.Context, user fnos.User, id, expected string) error {
	s.st.BlobsMu.Lock()
	defer s.st.BlobsMu.Unlock()
	keys, err := s.st.DeleteSave(ctx, user, id, expected)
	if err != nil {
		return err
	}
	for _, key := range keys {
		_ = s.st.RemoveBlob(user, key)
	}
	return nil
}

func (s *Service) SetThumb(ctx context.Context, user fnos.User, saveID string, data []byte) (store.Save, error) {
	if len(data) == 0 {
		return store.Save{}, ErrInvalidThumb
	}
	if int64(len(data)) > MaxThumbSize {
		return store.Save{}, store.ErrTooLarge
	}
	contentType := detectThumbImageType(data)
	if contentType == "" {
		return store.Save{}, ErrInvalidThumb
	}
	if _, err := s.st.Save(ctx, user, saveID); err != nil {
		return store.Save{}, err
	}
	blob, err := s.st.WriteBlob(ctx, user, "thumb", bytes.NewReader(data), MaxThumbSize)
	if err != nil {
		return store.Save{}, err
	}
	s.st.BlobsMu.Lock()
	updated, previous, err := s.st.SetSaveThumb(ctx, user, saveID, blob, contentType)
	s.st.BlobsMu.Unlock()
	if err != nil {
		_ = s.st.RemoveBlob(user, blob.Key)
		return store.Save{}, err
	}
	if previous != "" && previous != blob.Key {
		_ = s.st.RemoveBlob(user, previous)
	}
	return updated, nil
}

func (s *Service) OpenThumb(ctx context.Context, user fnos.User, saveID string) (store.CoverRecord, *os.File, error) {
	s.st.BlobsMu.RLock()
	defer s.st.BlobsMu.RUnlock()
	if _, err := s.st.Save(ctx, user, saveID); err != nil {
		return store.CoverRecord{}, nil, err
	}
	rec, err := s.st.GetSaveThumb(ctx, user, saveID)
	if err != nil {
		return store.CoverRecord{}, nil, err
	}
	f, err := s.st.OpenBlob(ctx, user, rec.Blob)
	if err != nil {
		return store.CoverRecord{}, nil, errors.Join(store.ErrCorrupt, err)
	}
	return rec, f, nil
}
