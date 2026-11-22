package library

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path"
	"strings"
	"syscall"

	"xiaoniubawang/internal/store"
)

type catalogEntry struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Filename   string `json:"filename"`
	SHA256     string `json:"sha256"`
	Screenshot string `json:"screenshot"`
	store.GameExtras
}

func (s *Service) loadBundled(ctx context.Context) error {
	if s.bundled == nil {
		return s.store.SyncBundled(ctx, nil)
	}
	catalog, err := s.openBundled("catalog.json")
	if errors.Is(err, os.ErrNotExist) {
		catalog, err = s.openBundled("library.json")
	}
	if errors.Is(err, os.ErrNotExist) {
		return s.store.SyncBundled(ctx, nil)
	}
	if err != nil {
		return err
	}
	defer catalog.Close()
	const maxCatalog = 1 << 20
	data, err := io.ReadAll(io.LimitReader(catalog, maxCatalog+1))
	if err != nil || len(data) > maxCatalog {
		return errors.New("could not read bundled game catalog")
	}
	var manifest struct {
		Games []catalogEntry `json:"games"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil || manifest.Games == nil {
		return errors.New("bundled catalog requires a games array")
	}
	games := make([]store.Game, 0, len(manifest.Games))
	seen := make(map[string]bool)
	for _, e := range manifest.Games {
		if seen[e.ID] || !store.ValidID(e.ID) || !SafeFilename(e.Filename) || !strings.EqualFold(path.Ext(e.Filename), ".nes") || !store.IsSHA256(e.SHA256) || e.License == "" {
			return errors.New("invalid bundled game identity, filename, SHA-256, or license")
		}
		source, err := url.Parse(e.SourceURL)
		if err != nil || source.User != nil || source.Hostname() == "" || source.Scheme != "https" && source.Scheme != "http" {
			return fmt.Errorf("invalid source URL for bundled game %q", e.ID)
		}
		seen[e.ID] = true
		title, err := cleanTitle(e.Title)
		if err != nil {
			return err
		}
		header, size, err := s.checkBundledROM(e)
		if err != nil {
			return fmt.Errorf("invalid bundle ROM %q: %w", e.ID, err)
		}
		extras := e.GameExtras
		if extras.Controls == "keyboard" {
			extras.Keyboard = true
		}
		if len(extras.Tags) == 0 {
			for _, tag := range []string{extras.Category, extras.Genre} {
				if tag != "" {
					extras.Tags = append(extras.Tags, tag)
				}
			}
		}
		extras.CoverURL = ""
		if e.Screenshot != "" {
			if !safeCover(e.Screenshot) {
				return fmt.Errorf("invalid screenshot name for bundled game %q", e.ID)
			}
			f, err := s.openBundled(e.Screenshot)
			if err != nil {
				return fmt.Errorf("unavailable screenshot for bundled game %q", e.ID)
			}
			_ = f.Close()
			extras.CoverURL = "/games/" + e.Screenshot
		}
		games = append(games, store.Game{ID: e.ID, Title: title, Filename: e.Filename, SHA256: e.SHA256,
			Size: size, Mapper: header.Mapper, Format: header.Format, BlobKey: e.Filename, GameExtras: extras})
	}
	return s.store.SyncBundled(ctx, games)
}

func (s *Service) checkBundledROM(e catalogEntry) (headerInfo, int64, error) {
	f, err := s.openBundled(e.Filename)
	if err != nil {
		return headerInfo{}, 0, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.Size() > MaxROMSize || st.Size() <= 0 {
		return headerInfo{}, 0, ErrInvalidROM
	}
	hash := sha256.New()
	header, err := parseROM(io.TeeReader(f, hash), st.Size())
	if err != nil {
		return headerInfo{}, 0, err
	}
	n, err := io.Copy(hash, io.LimitReader(f, MaxROMSize+1))
	if err != nil || n+16 != st.Size() || hex.EncodeToString(hash.Sum(nil)) != e.SHA256 {
		return headerInfo{}, 0, store.ErrCorrupt
	}
	return header, st.Size(), nil
}

func safeCover(name string) bool {
	switch strings.ToLower(path.Ext(name)) {
	case ".png", ".jpeg", ".jpg", ".webp", ".avif", ".gif":
	default:
		return false
	}
	for part := range strings.SplitSeq(name, "/") {
		if !SafeFilename(part) || strings.ContainsAny(part, "?#%") {
			return false
		}
	}
	return true
}

func (s *Service) openBundled(name string) (*os.File, error) {
	if s.bundled == nil {
		return nil, os.ErrNotExist
	}
	for part := range strings.SplitSeq(name, "/") {
		if !SafeFilename(part) {
			return nil, store.ErrInvalid
		}
	}
	f, err := s.bundled.OpenFile(name, os.O_RDONLY|syscall.O_NONBLOCK|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		_ = f.Close()
		return nil, store.ErrCorrupt
	}
	return f, nil
}

func (s *Service) OpenCover(name string) (*os.File, error) {
	if !safeCover(name) {
		return nil, os.ErrNotExist
	}
	return s.openBundled(name)
}
