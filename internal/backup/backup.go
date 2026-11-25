// Package backup exports and additively restores only an authenticated user's data.
package backup

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"

	"xiaoniubawang/internal/fnos"
	"xiaoniubawang/internal/library"
	"xiaoniubawang/internal/saves"
	"xiaoniubawang/internal/store"
)

const (
	Schema                 = "xiaoniubawang.user-backup"
	Version                = 1
	MaxMembers             = 4096
	MaxTotalBytes    int64 = 512 << 20
	MaxArchiveBytes  int64 = 544 << 20
	MaxManifestBytes int64 = 8 << 20
	MaxSettingsBytes int64 = 256 << 10
)

type ExportOptions struct {
	IncludeROMs bool
}

var ErrInvalid = errors.New("备份无效或版本不受支持")
var ErrLimit = errors.New("备份超过大小或成员数量限制")

type Library interface {
	List(context.Context, fnos.User) ([]store.Game, error)
	Open(context.Context, fnos.User, string) (store.Game, *os.File, error)
	Favorite(context.Context, fnos.User, string, bool) (store.Game, error)
	Import(context.Context, fnos.User, []library.Upload) ([]store.Game, error)
}
type Saves interface {
	List(context.Context, fnos.User, string) ([]store.Save, error)
	Open(context.Context, fnos.User, string) (store.Save, *os.File, error)
	Create(context.Context, fnos.User, saves.Input, io.Reader) (store.Save, error)
}
type Settings interface {
	Settings(context.Context, fnos.User) (string, error)
	SetSettings(context.Context, fnos.User, string) error
}

type Service struct {
	library  Library
	saves    Saves
	settings Settings
}

func New(st Settings, lib Library, sv Saves) *Service {
	return &Service{settings: st, library: lib, saves: sv}
}

type Member struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}
type Game struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Filename     string `json:"filename"`
	SHA256       string `json:"sha256"`
	Size         int64  `json:"size"`
	Source       string `json:"source"`
	Favorite     bool   `json:"favorite"`
	LastPlayedAt string `json:"lastPlayedAt,omitempty"`
	PlayCount    int64  `json:"playCount"`
	Member       string `json:"member,omitempty"`
	CoverMember  string `json:"coverMember,omitempty"`
}
type Save struct {
	ID          string `json:"id"`
	GameID      string `json:"gameId"`
	Kind        string `json:"kind"`
	Slot        int    `json:"slot"`
	Core        string `json:"core"`
	CoreVersion string `json:"coreVersion"`
	ROMSHA256   string `json:"romSha256"`
	SHA256      string `json:"sha256"`
	Size        int64  `json:"size"`
	Member      string `json:"member"`
	ThumbMember string `json:"thumbMember,omitempty"`
}
type Manifest struct {
	Schema    string   `json:"schema"`
	Version   int      `json:"version"`
	CreatedAt string   `json:"createdAt"`
	Settings  string   `json:"settings"`
	Games     []Game   `json:"games"`
	Saves     []Save   `json:"saves"`
	Members   []Member `json:"members"`
}
type Conflict struct {
	Kind    string `json:"kind"`
	ID      string `json:"id"`
	Message string `json:"message"`
}
type RestoreResult struct {
	ImportedGames    int        `json:"importedGames"`
	ExistingGames    int        `json:"existingGames"`
	RestoredSaves    int        `json:"restoredSaves"`
	RestoredCovers   int        `json:"restoredCovers,omitempty"`
	Conflicts        []Conflict `json:"conflicts"`
	SettingsRestored bool       `json:"settingsRestored"`
}

type coverAccess interface {
	OpenCustomCover(context.Context, fnos.User, string) (store.CoverRecord, *os.File, error)
	SetCover(context.Context, fnos.User, string, []byte) (store.Game, error)
}

type thumbAccess interface {
	OpenThumb(context.Context, fnos.User, string) (store.CoverRecord, *os.File, error)
	SetThumb(context.Context, fnos.User, string, []byte) (store.Save, error)
}

type cancelReader struct {
	ctx context.Context
	r   io.Reader
}

func (r cancelReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.r.Read(p)
}
func object(value []byte) (map[string]json.RawMessage, error) {
	if int64(len(value)) > MaxSettingsBytes {
		return nil, ErrLimit
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(value, &m) != nil || m == nil {
		return nil, ErrInvalid
	}
	return m, nil
}
