package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"xiaoniubawang/internal/fnos"
)

type Game struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Filename     string `json:"filename"`
	System       string `json:"system"`
	Source       string `json:"source"`
	SHA256       string `json:"sha256"`
	Size         int64  `json:"size"`
	Mapper       int    `json:"mapper"`
	Format       string `json:"format"`
	Favorite     bool   `json:"favorite"`
	CreatedAt    string `json:"createdAt"`
	LastPlayedAt string `json:"lastPlayedAt,omitempty"`
	PlayCount    int64  `json:"playCount"`
	GameExtras
	BlobKey string `json:"-"`
}

type GameExtras struct {
	Description       string   `json:"description,omitempty"`
	Category          string   `json:"category,omitempty"`
	Genre             string   `json:"genre,omitempty"`
	Tags              []string `json:"tags,omitempty"`
	Keyboard          bool     `json:"keyboard"`
	Controls          string   `json:"controls,omitempty"`
	Language          string   `json:"language,omitempty"`
	OriginalTitle     string   `json:"originalTitle,omitempty"`
	TranslationStatus string   `json:"translationStatus,omitempty"`
	Version           string   `json:"version,omitempty"`
	License           string   `json:"license,omitempty"`
	SourceURL         string   `json:"sourceUrl,omitempty"`
	CoverURL          string   `json:"coverUrl,omitempty"`
}

func (g Game) Blob() Blob { return Blob{g.BlobKey, g.Size, g.SHA256} }

const selectGames = `SELECT g.id,g.title,g.filename,g.sha256,g.size,g.mapper,g.format,g.blob,g.created_at,g.extras,
 CASE WHEN g.owner='' THEN 'bundled' ELSE 'imported' END,
 coalesce(a.favorite,0),coalesce(a.last_played_at,''),coalesce(a.play_count,0)` + gameScope

const gameScope = ` FROM games AS g LEFT JOIN activity AS a ON a.game_id=g.id AND a.owner=?
 WHERE g.available=1 AND (g.owner=? OR g.owner='')`

func scanGame(row interface{ Scan(...any) error }) (g Game, err error) {
	var extras string
	err = row.Scan(&g.ID, &g.Title, &g.Filename, &g.SHA256, &g.Size, &g.Mapper, &g.Format, &g.BlobKey,
		&g.CreatedAt, &extras, &g.Source, &g.Favorite, &g.LastPlayedAt, &g.PlayCount)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	if err != nil {
		return Game{}, err
	}
	g.System = "NES"
	if err := json.Unmarshal([]byte(extras), &g.GameExtras); err != nil {
		return Game{}, ErrCorrupt
	}
	return g, nil
}

func (s *Store) ListGames(ctx context.Context, user fnos.User) ([]Game, error) {
	if !validUser(user) {
		return nil, ErrInvalid
	}
	rows, err := s.db.QueryContext(ctx, selectGames+` ORDER BY g.title COLLATE NOCASE,g.id`, user, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	games := make([]Game, 0)
	for rows.Next() {
		g, err := scanGame(rows)
		if err != nil {
			return nil, err
		}
		games = append(games, g)
	}
	return games, rows.Err()
}

func (s *Store) Game(ctx context.Context, user fnos.User, id string) (Game, error) {
	if !validUser(user) || !ValidID(id) {
		return Game{}, ErrInvalid
	}
	return scanGame(s.db.QueryRowContext(ctx, selectGames+` AND g.id=?`, user, user, id))
}

const insertGame = `INSERT INTO games(id,owner,filename,title,sha256,size,mapper,format,blob,created_at,extras) VALUES(?,?,?,?,?,?,?,?,?,?,?)`

func gameArgs(g Game, user fnos.User) ([]any, error) {
	if !ValidID(g.ID) || !IsSHA256(g.SHA256) || g.Size <= 0 || !validUser(user) && user != "" || user != "" && !blobKey(g.BlobKey) {
		return nil, ErrInvalid
	}
	if g.CreatedAt == "" {
		g.CreatedAt = timestamp()
	}
	b, err := json.Marshal(g.GameExtras)
	return []any{g.ID, user, g.Filename, g.Title, g.SHA256, g.Size, g.Mapper, g.Format, g.BlobKey, g.CreatedAt, string(b)}, err
}

// CommitGames publishes the already-written files atomically. Exact duplicates
// in this user's library resolve to the existing row without overwriting it.
func (s *Store) CommitGames(ctx context.Context, user fnos.User, games []Game) ([]Game, error) {
	if !validUser(user) {
		return nil, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	out := make([]Game, 0, len(games))
	for _, g := range games {
		args, err := gameArgs(g, user)
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, insertGame+` ON CONFLICT(owner,sha256) WHERE owner<>'' DO NOTHING`, args...); err != nil {
			return nil, err
		}
		stored, err := scanGame(tx.QueryRowContext(ctx, selectGames+` AND g.owner=? AND g.sha256=?`, user, user, user, g.SHA256))
		if err != nil {
			return nil, err
		}
		out = append(out, stored)
	}
	return out, tx.Commit()
}

// SyncBundled makes only current catalog entries visible. Preserve activity and
// saves for temporarily removed titles. A different ROM requires a different ID.
func (s *Store) SyncBundled(ctx context.Context, games []Game) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE games SET available=0 WHERE owner=''`); err != nil {
		return err
	}
	for _, g := range games {
		args, err := gameArgs(g, "")
		if err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, insertGame+` ON CONFLICT(id) DO UPDATE SET
		  filename=excluded.filename,title=excluded.title,format=excluded.format,mapper=excluded.mapper,
		  size=excluded.size,blob=excluded.blob,extras=excluded.extras,available=1
		  WHERE games.owner='' AND games.sha256=excluded.sha256`, args...)
		if err != nil {
			return err
		}
		if n, err := result.RowsAffected(); err != nil || n != 1 {
			return errors.New("bundled game ID collides with an existing game or its ROM digest changed")
		}
	}
	return tx.Commit()
}

func (s *Store) Favorite(ctx context.Context, user fnos.User, id string, favorite bool) (Game, error) {
	return s.setActivity(ctx, user, id, `INSERT INTO activity(owner,game_id,favorite)
	 SELECT ?,id,? FROM games WHERE id=? AND available=1 AND (owner='' OR owner=?)
	 ON CONFLICT(owner,game_id) DO UPDATE SET favorite=excluded.favorite`, favorite)
}

func (s *Store) Launched(ctx context.Context, user fnos.User, id string) (Game, error) {
	return s.setActivity(ctx, user, id, `INSERT INTO activity(owner,game_id,last_played_at,play_count)
	 SELECT ?,id,?,1 FROM games WHERE id=? AND available=1 AND (owner='' OR owner=?)
	 ON CONFLICT(owner,game_id) DO UPDATE SET last_played_at=excluded.last_played_at,play_count=activity.play_count+1`, timestamp())
}

func (s *Store) setActivity(ctx context.Context, user fnos.User, id, query string, value any) (Game, error) {
	if !validUser(user) || !ValidID(id) {
		return Game{}, ErrInvalid
	}
	if _, err := s.db.ExecContext(ctx, query, user, value, id, user); err != nil {
		return Game{}, err
	}
	return s.Game(ctx, user, id)
}

// RestoreActivity merges an authorized game's recent history without counting a
// restore as a launch. Repeated imports and older records do not lower counts
// or replace newer local timestamps.
func (s *Store) RestoreActivity(ctx context.Context, user fnos.User, id, lastPlayedAt string, playCount int64) error {
	if !validUser(user) || !ValidID(id) || playCount < 0 || playCount > 1<<53-1 {
		return ErrInvalid
	}
	var last any
	if lastPlayedAt != "" {
		t, err := time.Parse(time.RFC3339Nano, lastPlayedAt)
		if err != nil {
			return ErrInvalid
		}
		last = t.UTC().Format(timestampLayout)
	}
	result, err := s.db.ExecContext(ctx, `INSERT INTO activity(owner,game_id,last_played_at,play_count)
	 SELECT ?,id,?,? FROM games WHERE id=? AND available=1 AND (owner='' OR owner=?)
	 ON CONFLICT(owner,game_id) DO UPDATE SET
	 last_played_at=CASE WHEN excluded.last_played_at>activity.last_played_at OR activity.last_played_at IS NULL THEN excluded.last_played_at ELSE activity.last_played_at END,
	 play_count=max(activity.play_count, excluded.play_count)`, user, last, playCount, id, user)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil {
		return err
	} else if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) RenameGame(ctx context.Context, user fnos.User, id, title string) (Game, error) {
	g, err := s.Game(ctx, user, id)
	if err != nil {
		return Game{}, err
	}
	if g.Source == "bundled" {
		return Game{}, ErrReadOnly
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE games SET title=? WHERE id=? AND owner=?`, title, id, user); err != nil {
		return Game{}, err
	}
	return s.Game(ctx, user, id)
}

// DeleteGame deletes imported metadata and its saves in one SQLite transaction.
// Returns keys to unlink after commit. The caller holds BlobsMu during this step.
func (s *Store) DeleteGame(ctx context.Context, user fnos.User, id string) ([]string, error) {
	if !validUser(user) || !ValidID(id) {
		return nil, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	g, err := scanGame(tx.QueryRowContext(ctx, selectGames+` AND g.id=?`, user, user, id))
	if err != nil {
		return nil, err
	}
	if g.Source == "bundled" {
		return nil, ErrReadOnly
	}
	rows, err := tx.QueryContext(ctx, `SELECT blob FROM saves WHERE owner=? AND game_id=?`, user, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := []string{g.BlobKey}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		if !strings.HasPrefix(key, "save-") || !blobKey(key) {
			return nil, ErrCorrupt
		}
		keys = append(keys, key)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM games WHERE id=? AND owner=?`, id, user); err != nil {
		return nil, err
	}
	return keys, tx.Commit()
}
