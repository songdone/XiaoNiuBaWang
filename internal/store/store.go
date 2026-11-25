// Package store owns the SQLite metadata and the private backing files.
package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"xiaoniubawang/internal/fnos"

	_ "modernc.org/sqlite"
)

var (
	ErrNotFound     = errors.New("record not found")
	ErrReadOnly     = errors.New("bundled game is read-only")
	ErrInvalid      = errors.New("invalid input")
	ErrTooLarge     = errors.New("file exceeds size limit")
	ErrCorrupt      = errors.New("blob does not match its metadata")
	ErrIncompatible = errors.New("save metadata does not match the game or slot")
)

type Store struct {
	db   *sql.DB
	root *os.Root
	lock *os.File

	// Pin a blob under the read lock before serving it. Writers can then unlink
	// obsolete blobs without interrupting readers holding a file descriptor.
	BlobsMu sync.RWMutex
}

const schema = `
CREATE TABLE games (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, filename TEXT NOT NULL, title TEXT NOT NULL,
  sha256 TEXT NOT NULL, size INTEGER NOT NULL CHECK(size>0), mapper INTEGER NOT NULL,
  format TEXT NOT NULL, blob TEXT NOT NULL, created_at TEXT NOT NULL,
  extras TEXT NOT NULL CHECK(json_valid(extras)), available INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX games_owned_sha ON games(owner,sha256) WHERE owner<>'';
CREATE TABLE activity (
  owner TEXT NOT NULL, game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)),
  last_played_at TEXT, play_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(owner,game_id)
);
CREATE TABLE saves (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, slot INTEGER NOT NULL, core TEXT NOT NULL, core_version TEXT NOT NULL,
  rom_sha256 TEXT NOT NULL, sha256 TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size>0), version INTEGER NOT NULL CHECK(version>0), blob TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK((kind='sram' AND slot=0) OR (kind='state' AND slot BETWEEN 0 AND 99)),
  UNIQUE(owner,game_id,kind,slot)
);
CREATE TABLE settings (
  owner TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(json_type(value)='object')
);
PRAGMA user_version = 1;`

func Open(ctx context.Context, path string) (_ *Store, err error) {
	if path == "" {
		return nil, errors.New("an app data directory is required")
	}
	path, err = filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(path, 0700); err != nil {
		return nil, err
	}
	before, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !private(before, true) {
		return nil, errors.New("app data directory must be owned by the service user with mode 0700 or stricter")
	}
	root, err := os.OpenRoot(path)
	if err != nil {
		return nil, err
	}
	s := &Store{root: root}
	defer func() {
		if err != nil {
			_ = s.Close()
		}
	}()
	if after, e := root.Stat("."); e != nil || !os.SameFile(before, after) {
		return nil, ErrCorrupt
	}
	if s.lock, err = openMetadata(root, "service.lock"); err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(s.lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return nil, errors.New("app data directory is locked or does not support file locking")
	}
	for _, name := range []string{"metadata.sqlite-wal", "metadata.sqlite-shm", "metadata.sqlite-journal"} {
		info, e := root.Lstat(name)
		if e == nil && !private(info, false) || e != nil && !errors.Is(e, os.ErrNotExist) {
			return nil, ErrCorrupt
		}
	}
	f, err := openMetadata(root, "metadata.sqlite")
	if err != nil {
		return nil, err
	}
	if err := f.Close(); err != nil {
		return nil, err
	}
	// SQLite opens its own sidecars. It runs inside the service-owned directory;
	// none of its path components come from a user or an HTTP request.
	dsn := url.URL{Scheme: "file", Path: filepath.Join(path, "metadata.sqlite")}
	q := dsn.Query()
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "foreign_keys(ON)")
	q.Add("_pragma", "synchronous(FULL)")
	dsn.RawQuery = q.Encode()
	s.db, err = sql.Open("sqlite", dsn.String())
	if err != nil {
		return nil, err
	}
	s.db.SetMaxOpenConns(1)
	var journal string
	if err := s.db.QueryRowContext(ctx, `PRAGMA journal_mode=WAL`).Scan(&journal); err != nil {
		return nil, err
	}
	if journal != "wal" {
		return nil, errors.New("SQLite WAL mode is required for metadata storage")
	}
	if err := migrate(ctx, s.db); err != nil {
		return nil, err
	}
	return s, nil
}

func private(info os.FileInfo, directory bool) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Geteuid()) || info.Mode().Perm()&0077 != 0 {
		return false
	}
	if directory {
		return info.IsDir()
	}
	return info.Mode().IsRegular() && stat.Nlink == 1
}

func openMetadata(root *os.Root, name string) (*os.File, error) {
	f, err := root.OpenFile(name, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
	if !errors.Is(err, os.ErrExist) {
		return f, err
	}
	info, err := root.Lstat(name)
	if err != nil || !private(info, false) {
		return nil, ErrCorrupt
	}
	f, err = root.OpenFile(name, os.O_RDWR|syscall.O_NONBLOCK|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	actual, err := f.Stat()
	if err != nil || !os.SameFile(info, actual) || !private(actual, false) {
		_ = f.Close()
		return nil, ErrCorrupt
	}
	return f, nil
}

const indexes = `
CREATE TABLE IF NOT EXISTS covers (
	owner TEXT NOT NULL,
	game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
	blob TEXT NOT NULL,
	sha256 TEXT NOT NULL,
	size INTEGER NOT NULL,
	content_type TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (owner, game_id)
);
CREATE TABLE IF NOT EXISTS save_thumbs (
	owner TEXT NOT NULL,
	save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
	blob TEXT NOT NULL,
	sha256 TEXT NOT NULL,
	size INTEGER NOT NULL,
	content_type TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (owner, save_id)
);
CREATE INDEX IF NOT EXISTS games_owner_avail_created ON games(owner,available,created_at DESC,id);
CREATE INDEX IF NOT EXISTS activity_owner_last ON activity(owner,last_played_at DESC,game_id);
CREATE INDEX IF NOT EXISTS saves_owner_game ON saves(owner,game_id);`

func migrate(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var version int
	if err := tx.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		return err
	}
	switch version {
	case 0:
		if _, err := tx.ExecContext(ctx, schema); err != nil {
			return err
		}
	case 1:
	default:
		return fmt.Errorf("unsupported database schema version %d", version)
	}
	if _, err := tx.ExecContext(ctx, indexes); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Close() error {
	var errs []error
	if s.db != nil {
		errs = append(errs, s.db.Close())
	}
	if s.lock != nil {
		errs = append(errs, s.lock.Close())
	}
	if s.root != nil {
		errs = append(errs, s.root.Close())
	}
	return errors.Join(errs...)
}

func (s *Store) Health(ctx context.Context) error {
	var version int
	if err := s.db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		return err
	}
	if version != 1 {
		return errors.New("unexpected database schema version")
	}
	return nil
}

func NewID() string {
	var b [16]byte
	rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func IsSHA256(value string) bool { return hexToken(value, 64) }

func hexToken(value string, n int) bool {
	if len(value) != n {
		return false
	}
	for i := range len(value) {
		c := value[i]
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func ValidID(value string) bool {
	if value == "" || len(value) > 96 || value == "." || value == ".." {
		return false
	}
	for i := range len(value) {
		c := value[i]
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_' || c == '.') {
			return false
		}
	}
	return true
}

func validUser(user fnos.User) bool {
	key := string(user)
	if suffix, ok := strings.CutPrefix(key, "dev-"); ok {
		return IsSHA256(suffix)
	}
	suffix, ok := strings.CutPrefix(key, "uid-")
	return ok && len(suffix) > 0 && len(suffix) <= 19 && suffix[0] != '0' && strings.IndexFunc(suffix, func(c rune) bool { return c < '0' || c > '9' }) < 0
}

const timestampLayout = "2006-01-02T15:04:05.000000000Z"

func timestamp() string { return time.Now().UTC().Format(timestampLayout) }

func (s *Store) Settings(ctx context.Context, user fnos.User) (string, error) {
	if !validUser(user) {
		return "", ErrInvalid
	}
	var value string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE owner=?`, user).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "{}", nil
	}
	return value, err
}

func (s *Store) SetSettings(ctx context.Context, user fnos.User, value string) error {
	if !validUser(user) {
		return ErrInvalid
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO settings(owner,value) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET value=excluded.value`, user, value)
	return err
}
