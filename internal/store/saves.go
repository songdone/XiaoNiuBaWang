package store

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"

	"xiaoniubawang/internal/fnos"
)

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
	Version     int64  `json:"version"`
	ETag        string `json:"etag"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
	BlobKey     string `json:"-"`
}

func (s Save) Blob() Blob { return Blob{s.BlobKey, s.Size, s.SHA256} }

// SaveConflict carries only an authorized current version of the slot.
type SaveConflict struct {
	Current Save
	Exists  bool // true on a create against an occupied slot
}

func (*SaveConflict) Error() string { return "save slot conflict" }

const selectSaves = `SELECT s.id,s.game_id,s.kind,s.slot,s.core,s.core_version,s.rom_sha256,s.sha256,s.size,s.version,s.blob,s.created_at,s.updated_at
 FROM saves AS s JOIN games AS g ON g.id=s.game_id AND g.sha256=s.rom_sha256
 WHERE s.owner=? AND g.available=1 AND (g.owner=s.owner OR g.owner='')`

func scanSave(row interface{ Scan(...any) error }) (s Save, err error) {
	err = row.Scan(&s.ID, &s.GameID, &s.Kind, &s.Slot, &s.Core, &s.CoreVersion, &s.ROMSHA256, &s.SHA256,
		&s.Size, &s.Version, &s.BlobKey, &s.CreatedAt, &s.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Save{}, ErrNotFound
	}
	if err == nil {
		s.ETag = `"` + s.ID + `-` + strconv.FormatInt(s.Version, 10) + `-` + s.SHA256 + `"`
	}
	return s, err
}

func (s *Store) ListSaves(ctx context.Context, user fnos.User, gameID string) ([]Save, error) {
	if !validUser(user) || !ValidID(gameID) {
		return nil, ErrInvalid
	}
	rows, err := s.db.QueryContext(ctx, selectSaves+` AND s.game_id=? ORDER BY s.kind,s.slot`, user, gameID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Save, 0)
	for rows.Next() {
		v, err := scanSave(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) Save(ctx context.Context, user fnos.User, id string) (Save, error) {
	if !validUser(user) || !ValidID(id) {
		return Save{}, ErrInvalid
	}
	return scanSave(s.db.QueryRowContext(ctx, selectSaves+` AND s.id=?`, user, id))
}

func (s *Store) InsertSave(ctx context.Context, user fnos.User, slot Save) (Save, error) {
	if !validUser(user) || !ValidID(slot.ID) || !ValidID(slot.GameID) || !IsSHA256(slot.ROMSHA256) || !validSaveBlob(slot.Blob()) {
		return Save{}, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Save{}, err
	}
	defer tx.Rollback()
	game, err := scanGame(tx.QueryRowContext(ctx, selectGames+` AND g.id=?`, user, user, slot.GameID))
	if err != nil {
		return Save{}, err
	}
	if game.SHA256 != slot.ROMSHA256 {
		return Save{}, ErrIncompatible
	}
	now := timestamp()
	res, err := tx.ExecContext(ctx, `INSERT INTO saves(id,owner,game_id,kind,slot,core,core_version,rom_sha256,sha256,size,version,blob,created_at,updated_at)
	 VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?) ON CONFLICT(owner,game_id,kind,slot) DO NOTHING`,
		slot.ID, user, slot.GameID, slot.Kind, slot.Slot, slot.Core, slot.CoreVersion, slot.ROMSHA256, slot.SHA256, slot.Size, slot.BlobKey, now, now)
	if err != nil {
		return Save{}, err
	}
	actual, err := scanSave(tx.QueryRowContext(ctx, selectSaves+` AND s.game_id=? AND s.kind=? AND s.slot=?`, user, slot.GameID, slot.Kind, slot.Slot))
	if err != nil {
		return Save{}, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return Save{}, err
	}
	if n == 0 {
		return Save{}, &SaveConflict{Current: actual, Exists: true}
	}
	return actual, tx.Commit()
}

func validSaveBlob(b Blob) bool {
	return b.Size > 0 && IsSHA256(b.SHA256) && strings.HasPrefix(b.Key, "save-") && blobKey(b.Key)
}

// SwapSave compares against the last committed revision and returns the old blob
// only after success. Both this and DeleteSave run while holding BlobsMu.
func (s *Store) SwapSave(ctx context.Context, user fnos.User, id, expected string, blob Blob) (Save, string, error) {
	if !validUser(user) || !ValidID(id) || !validSaveBlob(blob) {
		return Save{}, "", ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Save{}, "", err
	}
	defer tx.Rollback()
	old, err := scanSave(tx.QueryRowContext(ctx, selectSaves+` AND s.id=?`, user, id))
	if err != nil {
		return Save{}, "", err
	}
	if old.ETag != expected {
		return Save{}, "", &SaveConflict{Current: old}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE saves SET version=version+1,blob=?,size=?,sha256=?,updated_at=? WHERE owner=? AND id=?`,
		blob.Key, blob.Size, blob.SHA256, timestamp(), user, id); err != nil {
		return Save{}, "", err
	}
	slot, err := scanSave(tx.QueryRowContext(ctx, selectSaves+` AND s.id=?`, user, id))
	if err != nil {
		return Save{}, "", err
	}
	if err := tx.Commit(); err != nil {
		return Save{}, "", err
	}
	return slot, old.BlobKey, nil
}

func (s *Store) DeleteSave(ctx context.Context, user fnos.User, id, expected string) (string, error) {
	if !validUser(user) || !ValidID(id) {
		return "", ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	old, err := scanSave(tx.QueryRowContext(ctx, selectSaves+` AND s.id=?`, user, id))
	if err != nil {
		return "", err
	}
	if old.ETag != expected {
		return "", &SaveConflict{Current: old}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM saves WHERE owner=? AND id=?`, user, id); err != nil {
		return "", err
	}
	return old.BlobKey, tx.Commit()
}
