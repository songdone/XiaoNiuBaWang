package backup

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"strconv"

	"xiaoniubawang/internal/fnos"
	"xiaoniubawang/internal/library"
	"xiaoniubawang/internal/saves"
	"xiaoniubawang/internal/store"
)

type activityRestorer interface {
	RestoreActivity(context.Context, fnos.User, string, string, int64) error
}

// Restore is additive. Imported ROMs are matched by digest within their source;
// bundled and imported entries keep separate metadata and save slots. Occupied
// slots stay intact, favorites merge by union, and existing setting values win.
// Archive IDs and revisions never become overwrite conditions.
// Cancellation keeps already committed additions; retrying safely deduplicates.
func (s *Service) Restore(ctx context.Context, user fnos.User, r io.ReaderAt, size int64) (RestoreResult, error) {
	out := RestoreResult{Conflicts: []Conflict{}}
	v, err := validate(ctx, r, size)
	if err != nil {
		return out, err
	}
	local, err := s.library.List(ctx, user)
	if err != nil {
		return out, err
	}
	bySourceHash := map[string]store.Game{}
	byID := map[string]store.Game{}
	for _, g := range local {
		bySourceHash[g.Source+":"+g.SHA256] = g
		byID[g.ID] = g
	}
	mapped := map[string]store.Game{}
	conflict := func(kind, id, message string) { out.Conflicts = append(out.Conflicts, Conflict{kind, id, message}) }
	for _, g := range v.manifest.Games {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		key := g.Source + ":" + g.SHA256
		current, exists := bySourceHash[key]
		if g.Source == "bundled" {
			if exact, ok := byID[g.ID]; ok && exact.Source == "bundled" && exact.SHA256 == g.SHA256 {
				current, exists = exact, true
			}
		}
		if exists {
			out.ExistingGames++
		} else if g.Source == "imported" {
			imported, err := s.library.Import(ctx, user, []library.Upload{{Filename: g.Filename, Title: g.Title, Reader: bytes.NewReader(v.data[g.Member])}})
			if err != nil {
				return out, err
			}
			if len(imported) != 1 || imported[0].SHA256 != g.SHA256 {
				return out, ErrInvalid
			}
			current = imported[0]
			bySourceHash[key] = current
			out.ImportedGames++
		} else {
			conflict("game", g.ID, "当前游戏目录中没有此内置 ROM")
			continue
		}
		mapped[g.ID] = current
		if g.Favorite && !current.Favorite {
			updated, err := s.library.Favorite(ctx, user, current.ID, true)
			if err != nil {
				return out, err
			}
			bySourceHash[key] = updated
		}
		if g.LastPlayedAt != "" || g.PlayCount != 0 {
			if a, ok := s.settings.(activityRestorer); ok {
				if err := a.RestoreActivity(ctx, user, current.ID, g.LastPlayedAt, g.PlayCount); err != nil {
					return out, err
				}
			} else {
				conflict("activity", g.ID, "备份包含最近游玩记录，但当前服务暂不支持合并该记录")
			}
		}
	}
	occupied := map[string]map[string]bool{}
	for _, sv := range v.manifest.Saves {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		g, ok := mapped[sv.GameID]
		if !ok {
			conflict("save", sv.ID, "关联的 ROM 不可用")
			continue
		}
		if occupied[g.ID] == nil {
			slots, err := s.saves.List(ctx, user, g.ID)
			if err != nil {
				return out, err
			}
			occupied[g.ID] = map[string]bool{}
			for _, existing := range slots {
				occupied[g.ID][existing.Kind+":"+strconv.Itoa(existing.Slot)] = true
			}
		}
		key := sv.Kind + ":" + strconv.Itoa(sv.Slot)
		if occupied[g.ID][key] {
			conflict("save", sv.ID, "存档槽位已存在，已保留原有存档")
			continue
		}
		_, err := s.saves.Create(ctx, user, saves.Input{GameID: g.ID, Kind: sv.Kind, Slot: sv.Slot, Core: sv.Core, CoreVersion: sv.CoreVersion, ROMSHA256: sv.ROMSHA256, SHA256: sv.SHA256}, bytes.NewReader(v.data[sv.Member]))
		if err != nil {
			var c *store.SaveConflict
			if errors.As(err, &c) {
				conflict("save", sv.ID, "其他请求已创建此槽位，已保留现有存档")
				occupied[g.ID][key] = true
				continue
			}
			return out, err
		}
		occupied[g.ID][key] = true
		out.RestoredSaves++
	}
	if err := ctx.Err(); err != nil {
		return out, err
	}
	currentSettings, err := s.settings.Settings(ctx, user)
	if err != nil {
		return out, err
	}
	current, err := object([]byte(currentSettings))
	if err != nil {
		return out, err
	}
	changed := false
	conflicted := false
	for key, value := range v.settings {
		if existing, ok := current[key]; ok {
			var a, b bytes.Buffer
			if json.Compact(&a, existing) != nil || json.Compact(&b, value) != nil {
				return out, ErrInvalid
			}
			if !bytes.Equal(a.Bytes(), b.Bytes()) {
				conflict("settings", "settings", "已保留现有设置项")
				conflicted = true
			}
			continue
		}
		current[key] = value
		changed = true
	}
	if changed {
		b, err := json.Marshal(current)
		if err != nil {
			return out, err
		}
		if int64(len(b)) > MaxSettingsBytes {
			conflict("settings", "", "合并后的设置超过大小限制，已保留现有设置")
			return out, nil
		}
		if err = s.settings.SetSettings(ctx, user, string(b)); err != nil {
			return out, err
		}
	}
	out.SettingsRestored = !conflicted
	return out, nil
}
