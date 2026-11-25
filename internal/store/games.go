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
 coalesce(a.favorite,0),coalesce(a.last_played_at,''),coalesce(a.play_count,0),
 coalesce((SELECT c.sha256 FROM covers AS c WHERE c.owner=g.owner AND c.game_id=g.id),'')` + gameScope

const gameScope = ` FROM games AS g LEFT JOIN activity AS a ON a.game_id=g.id AND a.owner=?
 WHERE g.available=1 AND (g.owner=? OR g.owner='')`

func scanGame(row interface{ Scan(...any) error }) (g Game, err error) {
	var extras, coverSHA string
	err = row.Scan(&g.ID, &g.Title, &g.Filename, &g.SHA256, &g.Size, &g.Mapper, &g.Format, &g.BlobKey,
		&g.CreatedAt, &extras, &g.Source, &g.Favorite, &g.LastPlayedAt, &g.PlayCount, &coverSHA)
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
	if len(coverSHA) >= 12 {
		g.CoverURL = "/api/games/" + g.ID + "/cover?v=" + coverSHA[:12]
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

// HasGameBySHA256 checks whether this user already owns an imported ROM with
// the exact digest, allowing callers to skip redundant blob writes on rescan.
func (s *Store) HasGameBySHA256(ctx context.Context, user fnos.User, sha256 string) (Game, bool, error) {
	if !validUser(user) || !IsSHA256(sha256) {
		return Game{}, false, ErrInvalid
	}
	g, err := scanGame(s.db.QueryRowContext(ctx, selectGames+` AND g.owner=? AND g.sha256=?`, user, user, user, sha256))
	if errors.Is(err, ErrNotFound) {
		return Game{}, false, nil
	}
	if err != nil {
		return Game{}, false, err
	}
	return g, true, nil
}

// CommitGames publishes the already-written files atomically. Exact duplicates
// in this user's library resolve to the existing row without overwriting it.
func (s *Store) CommitGames(ctx context.Context, user fnos.User, games []Game) ([]Game, error) {
	out, _, _, err := s.CommitGamesDetailed(ctx, user, games)
	return out, err
}

// CommitGamesDetailed publishes games atomically and separates newly inserted
// entries from exact-digest duplicates already present in this user's library.
func (s *Store) CommitGamesDetailed(ctx context.Context, user fnos.User, games []Game) ([]Game, int, int, error) {
	if !validUser(user) {
		return nil, 0, 0, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, 0, 0, err
	}
	defer tx.Rollback()
	out := make([]Game, 0, len(games))
	created, skipped := 0, 0
	for _, g := range games {
		args, err := gameArgs(g, user)
		if err != nil {
			return nil, 0, 0, err
		}
		res, err := tx.ExecContext(ctx, insertGame+` ON CONFLICT(owner,sha256) WHERE owner<>'' DO NOTHING`, args...)
		if err != nil {
			return nil, 0, 0, err
		}
		affected, err := res.RowsAffected()
		if err != nil {
			return nil, 0, 0, err
		}
		if affected > 0 {
			created++
		} else {
			skipped++
		}
		stored, err := scanGame(tx.QueryRowContext(ctx, selectGames+` AND g.owner=? AND g.sha256=?`, user, user, user, g.SHA256))
		if err != nil {
			return nil, 0, 0, err
		}
		out = append(out, stored)
	}
	if err := tx.Commit(); err != nil {
		return nil, 0, 0, err
	}
	return out, created, skipped, nil
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
	thumbRows, err := tx.QueryContext(ctx, `SELECT t.blob FROM save_thumbs AS t JOIN saves AS s ON s.id=t.save_id AND s.owner=t.owner WHERE t.owner=? AND s.game_id=?`, user, id)
	if err != nil {
		return nil, err
	}
	defer thumbRows.Close()
	for thumbRows.Next() {
		var key string
		if err := thumbRows.Scan(&key); err != nil {
			return nil, err
		}
		if !strings.HasPrefix(key, "thumb-") || !blobKey(key) {
			return nil, ErrCorrupt
		}
		keys = append(keys, key)
	}
	if err := thumbRows.Err(); err != nil {
		return nil, err
	}
	if err := thumbRows.Close(); err != nil {
		return nil, err
	}
	var coverKey string
	if err := tx.QueryRowContext(ctx, `SELECT blob FROM covers WHERE owner=? AND game_id=?`, user, id).Scan(&coverKey); err == nil {
		if !strings.HasPrefix(coverKey, "cover-") || !blobKey(coverKey) {
			return nil, ErrCorrupt
		}
		keys = append(keys, coverKey)
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM games WHERE id=? AND owner=?`, id, user); err != nil {
		return nil, err
	}
	return keys, tx.Commit()
}

type CoverRecord struct {
	Blob        Blob
	ContentType string
	UpdatedAt   string
}

func (s *Store) GetCover(ctx context.Context, user fnos.User, gameID string) (CoverRecord, error) {
	if !validUser(user) || !ValidID(gameID) {
		return CoverRecord{}, ErrInvalid
	}
	var rec CoverRecord
	err := s.db.QueryRowContext(ctx, `SELECT blob,sha256,size,content_type,updated_at FROM covers WHERE owner=? AND game_id=?`, user, gameID).
		Scan(&rec.Blob.Key, &rec.Blob.SHA256, &rec.Blob.Size, &rec.ContentType, &rec.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CoverRecord{}, ErrNotFound
	}
	if err != nil {
		return CoverRecord{}, err
	}
	return rec, nil
}

// SetCover replaces an imported game's custom cover metadata atomically and
// returns the previous blob key (if any) for post-commit cleanup.
func (s *Store) SetCover(ctx context.Context, user fnos.User, gameID string, blob Blob, contentType string) (Game, string, error) {
	if !validUser(user) || !ValidID(gameID) || !strings.HasPrefix(blob.Key, "cover-") || !blobKey(blob.Key) || !IsSHA256(blob.SHA256) || blob.Size <= 0 {
		return Game{}, "", ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Game{}, "", err
	}
	defer tx.Rollback()
	g, err := scanGame(tx.QueryRowContext(ctx, selectGames+` AND g.id=?`, user, user, gameID))
	if err != nil {
		return Game{}, "", err
	}
	if g.Source == "bundled" {
		return Game{}, "", ErrReadOnly
	}
	var previous string
	if err := tx.QueryRowContext(ctx, `SELECT blob FROM covers WHERE owner=? AND game_id=?`, user, gameID).Scan(&previous); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Game{}, "", err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO covers(owner,game_id,blob,sha256,size,content_type,updated_at) VALUES(?,?,?,?,?,?,?)
		ON CONFLICT(owner,game_id) DO UPDATE SET blob=excluded.blob,sha256=excluded.sha256,size=excluded.size,content_type=excluded.content_type,updated_at=excluded.updated_at`,
		user, gameID, blob.Key, blob.SHA256, blob.Size, contentType, timestamp()); err != nil {
		return Game{}, "", err
	}
	updated, err := scanGame(tx.QueryRowContext(ctx, selectGames+` AND g.id=?`, user, user, gameID))
	if err != nil {
		return Game{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return Game{}, "", err
	}
	return updated, previous, nil
}

// DeleteCover removes an imported game's custom cover and returns the removed blob key.
func (s *Store) DeleteCover(ctx context.Context, user fnos.User, gameID string) (Game, string, error) {
	if !validUser(user) || !ValidID(gameID) {
		return Game{}, "", ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Game{}, "", err
	}
	defer tx.Rollback()
	g, err := scanGame(tx.QueryRowContext(ctx, selectGames+` AND g.id=?`, user, user, gameID))
	if err != nil {
		return Game{}, "", err
	}
	if g.Source == "bundled" {
		return Game{}, "", ErrReadOnly
	}
	var previous string
	if err := tx.QueryRowContext(ctx, `SELECT blob FROM covers WHERE owner=? AND game_id=?`, user, gameID).Scan(&previous); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return g, "", nil
		}
		return Game{}, "", err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM covers WHERE owner=? AND game_id=?`, user, gameID); err != nil {
		return Game{}, "", err
	}
	updated, err := scanGame(tx.QueryRowContext(ctx, selectGames+` AND g.id=?`, user, user, gameID))
	if err != nil {
		return Game{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return Game{}, "", err
	}
	return updated, previous, nil
}
