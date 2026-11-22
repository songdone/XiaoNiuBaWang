package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"strings"

	"xiaoniubawang/internal/fnos"

	"modernc.org/sqlite"
)

// Register before any Store opens a connection. This pure, application-owned
// function reads no files or state; SQLite's built-in lower only folds ASCII.
func init() {
	sqlite.MustRegisterDeterministicScalarFunction("xnbw_fold", 1, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		if args[0] == nil {
			return "", nil
		}
		text, ok := args[0].(string)
		if !ok {
			return nil, ErrInvalid
		}
		return strings.ToLower(text), nil
	})
}

type GameQuery struct {
	Page     int
	PageSize int
	View     string
	Category string
	Sort     string
	Search   string
}

type GameStats struct {
	Total     int `json:"total"`
	Favorites int `json:"favorites"`
	Recent    int `json:"recent"`
}

type GamePage struct {
	Games      []Game    `json:"games"`
	Total      int       `json:"total"`
	Page       int       `json:"page"`
	PageSize   int       `json:"pageSize"`
	TotalPages int       `json:"totalPages"`
	RangeStart int       `json:"rangeStart"`
	RangeEnd   int       `json:"rangeEnd"`
	Stats      GameStats `json:"stats"`
}

func (q GameQuery) normalized() (GameQuery, error) {
	if q.Page == 0 {
		q.Page = 1
	}
	if q.PageSize == 0 {
		q.PageSize = 20
	}
	if q.View == "" {
		q.View = "all"
	}
	if q.Category == "" {
		q.Category = "all"
	}
	if q.Sort == "" {
		q.Sort = "added"
	}
	if q.Page < 1 || q.PageSize < 1 || q.PageSize > 500 ||
		(q.View != "all" && q.View != "favorites" && q.View != "recent") ||
		(q.Category != "all" && q.Category != "game" && q.Category != "learning") ||
		(q.Sort != "added" && q.Sort != "title" && q.Sort != "recent") {
		return GameQuery{}, ErrInvalid
	}
	if q.View == "recent" {
		q.Sort = "recent"
	}
	return q, nil
}

const recentGameOrder = ` ORDER BY nullif(a.last_played_at,'') DESC,g.id`

// QueryGames filters and orders the whole visible library before LIMIT. Counts
// and page rows share a read transaction, including unfiltered per-user stats.
// Only page rows are decoded/allocated. Title ordering is deterministic folded
// Unicode codepoint order (SQLite BINARY), not Chinese locale collation.
func (s *Store) QueryGames(ctx context.Context, user fnos.User, query GameQuery) (GamePage, error) {
	if !validUser(user) {
		return GamePage{}, ErrInvalid
	}
	q, err := query.normalized()
	if err != nil {
		return GamePage{}, err
	}
	filters := ""
	args := []any{user, user}
	switch q.View {
	case "favorites":
		filters += ` AND a.favorite=1`
	case "recent":
		filters += ` AND nullif(a.last_played_at,'') IS NOT NULL`
	}
	switch q.Category {
	case "learning":
		filters += ` AND (coalesce(json_extract(g.extras,'$.keyboard'),0)=1 OR json_extract(g.extras,'$.category')='learning')`
	case "game":
		// Preserve the library UI's classification: keyboard titles or an
		// explicit learning category are learning; everything else is a game.
		filters += ` AND coalesce(json_extract(g.extras,'$.keyboard'),0)<>1 AND coalesce(json_extract(g.extras,'$.category'),'')<>'learning'`
	}
	if q.Search != "" {
		// instr, unlike LIKE, treats % and _ literally. Decode JSON fields and
		// each individual tag so escaping/adjacent tags never create matches.
		filters += ` AND (instr(xnbw_fold(g.title),?)>0 OR instr(xnbw_fold(g.filename),?)>0
		 OR instr(xnbw_fold(json_extract(g.extras,'$.originalTitle')),?)>0
		 OR EXISTS (SELECT 1 FROM json_each(g.extras,'$.tags') AS tag
		 WHERE tag.type='text' AND instr(xnbw_fold(tag.value),?)>0))`
		needle := strings.ToLower(q.Search)
		args = append(args, needle, needle, needle, needle)
	}
	order := ` ORDER BY g.created_at DESC,g.id`
	switch q.Sort {
	case "title":
		order = ` ORDER BY xnbw_fold(g.title) COLLATE BINARY,g.id`
	case "recent":
		order = recentGameOrder
	}

	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return GamePage{}, err
	}
	defer tx.Rollback()
	out := GamePage{Games: make([]Game, 0), Page: q.Page, PageSize: q.PageSize, TotalPages: 1}
	if err := tx.QueryRowContext(ctx, `SELECT count(*),coalesce(sum(a.favorite=1),0),
	 coalesce(sum(nullif(a.last_played_at,'') IS NOT NULL),0)`+gameScope, user, user).
		Scan(&out.Stats.Total, &out.Stats.Favorites, &out.Stats.Recent); err != nil {
		return GamePage{}, err
	}
	if err := tx.QueryRowContext(ctx, `SELECT count(*)`+gameScope+filters, args...).Scan(&out.Total); err != nil {
		return GamePage{}, err
	}
	if out.Total > 0 {
		out.TotalPages = (out.Total-1)/q.PageSize + 1
	}
	if out.Page > out.TotalPages {
		out.Page = out.TotalPages
	}
	offset := (out.Page - 1) * q.PageSize
	pageArgs := append(args, q.PageSize, offset)
	rows, err := tx.QueryContext(ctx, selectGames+filters+order+` LIMIT ? OFFSET ?`, pageArgs...)
	if err != nil {
		return GamePage{}, err
	}
	defer rows.Close()
	for rows.Next() {
		g, err := scanGame(rows)
		if err != nil {
			return GamePage{}, err
		}
		out.Games = append(out.Games, g)
	}
	if err := rows.Err(); err != nil {
		return GamePage{}, err
	}
	if err := rows.Close(); err != nil {
		return GamePage{}, err
	}
	if out.Total > 0 {
		out.RangeStart, out.RangeEnd = offset+1, offset+len(out.Games)
	}
	return out, tx.Commit()
}
