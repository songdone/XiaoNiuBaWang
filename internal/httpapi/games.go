package httpapi

import (
	"bytes"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"xiaoniubawang/internal/fnos"
	"xiaoniubawang/internal/library"
	"xiaoniubawang/internal/store"
)

func (h *Handler) gameView(g store.Game) store.Game {
	if g.CoverURL != "" {
		g.CoverURL = h.prefix() + (&url.URL{Path: g.CoverURL}).EscapedPath()
	}
	return g
}

// Pagination is opt-in. Legacy query strings and full-list response shapes stay
// unchanged when the paginated key is absent.
func parseGameQuery(raw string) (store.GameQuery, bool, error) {
	values, err := url.ParseQuery(raw)
	_, paginated := values["paginated"]
	if !paginated && err != nil {
		// ParseQuery drops malformed pairs. A malformed opt-in value must
		// still be rejected rather than silently becoming a legacy request.
		for pair := range strings.SplitSeq(raw, "&") {
			key, _, _ := strings.Cut(pair, "=")
			decoded, e := url.QueryUnescape(key)
			if e == nil && decoded == "paginated" {
				paginated = true
				break
			}
		}
	}
	if !paginated {
		return store.GameQuery{}, false, nil
	}
	if err != nil {
		return store.GameQuery{}, true, store.ErrInvalid
	}
	q := store.GameQuery{Page: 1, PageSize: 20, View: "all", Category: "all", Sort: "added"}
	for key, v := range values {
		if len(v) != 1 {
			return q, true, store.ErrInvalid
		}
		switch key {
		case "paginated":
			if v[0] != "1" {
				return q, true, store.ErrInvalid
			}
		case "page", "pageSize":
			text := v[0]
			if text == "" || strings.IndexFunc(text, func(c rune) bool { return c < '0' || c > '9' }) >= 0 {
				return q, true, store.ErrInvalid
			}
			n, err := strconv.Atoi(text)
			if err != nil || n < 1 || key == "pageSize" && n > 500 {
				return q, true, store.ErrInvalid
			}
			if key == "page" {
				q.Page = n
			} else {
				q.PageSize = n
			}
		case "view":
			if v[0] != "all" && v[0] != "favorites" && v[0] != "recent" {
				return q, true, store.ErrInvalid
			}
			q.View = v[0]
		case "category":
			if v[0] != "all" && v[0] != "game" && v[0] != "learning" {
				return q, true, store.ErrInvalid
			}
			q.Category = v[0]
		case "sort":
			if v[0] != "added" && v[0] != "title" && v[0] != "recent" {
				return q, true, store.ErrInvalid
			}
			q.Sort = v[0]
		case "search":
			q.Search = v[0]
		default:
			return q, true, store.ErrInvalid
		}
	}
	return q, true, nil
}

func (h *Handler) listGames(w http.ResponseWriter, r *http.Request, user fnos.User, stats bool) {
	query, paginated, err := parseGameQuery(r.URL.RawQuery)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if paginated {
		page, err := h.cfg.Library.Query(r.Context(), user, query)
		if err != nil {
			h.fail(w, r, err)
			return
		}
		for i := range page.Games {
			page.Games[i] = h.gameView(page.Games[i])
		}
		writeJSON(w, r, http.StatusOK, page)
		return
	}
	games, err := h.cfg.Library.List(r.Context(), user)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	favorite, recent := 0, 0
	for i := range games {
		games[i] = h.gameView(games[i])
		if games[i].Favorite {
			favorite++
		}
		if games[i].LastPlayedAt != "" {
			recent++
		}
	}
	response := map[string]any{"games": games}
	if stats {
		response["stats"] = map[string]int{"total": len(games), "favorites": favorite, "recent": recent}
	}
	writeJSON(w, r, http.StatusOK, response)
}

func (h *Handler) importGames(w http.ResponseWriter, r *http.Request, user fnos.User) {
	if !h.uploading(w, r) {
		return
	}
	defer func() { <-h.uploads }()
	m, err := multipartBody(w, r, library.MaxROMSize*library.MaxUploads+(128<<10))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var title *string
	var uploads []library.Upload
	for {
		p, e := m.NextRawPart()
		if e == io.EOF {
			break
		}
		if e != nil {
			h.fail(w, r, multipartError(e))
			return
		}
		field, filename, file, e := partInfo(p)
		if e != nil {
			h.fail(w, r, e)
			return
		}
		switch {
		case file && (field == "file" || field == "files") && len(uploads) < library.MaxUploads && library.SafeFilename(filename):
			data, err := readPart(p, library.MaxROMSize)
			if err != nil {
				h.fail(w, r, err)
				return
			}
			uploads = append(uploads, library.Upload{Filename: filename, Reader: bytes.NewReader(data)})
		case !file && field == "title" && title == nil:
			data, err := readPart(p, 256)
			if err != nil {
				h.fail(w, r, err)
				return
			}
			v := strings.TrimSpace(string(data))
			title = &v
		default:
			h.fail(w, r, store.ErrInvalid)
			return
		}
	}
	if title != nil {
		if len(uploads) != 1 || *title == "" {
			h.fail(w, r, store.ErrInvalid)
			return
		}
		uploads[0].Title = *title
	}
	games, err := h.cfg.Library.Import(r.Context(), user, uploads)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	response := map[string]any{"games": games}
	if len(games) == 1 {
		response["game"] = games[0]
		w.Header().Set("Location", h.prefix()+"/api/games/"+games[0].ID)
	}
	writeJSON(w, r, http.StatusCreated, response)
}

func (h *Handler) game(w http.ResponseWriter, r *http.Request, user fnos.User, subpath []string) {
	id := subpath[0]
	if !store.ValidID(id) {
		h.fail(w, r, store.ErrInvalid)
		return
	}
	if len(subpath) > 1 {
		switch subpath[1] {
		case "favorite":
			h.favorite(w, r, user, id)
		case "launch":
			h.launch(w, r, user, id)
		default:
			h.fail(w, r, store.ErrNotFound)
		}
		return
	}
	if !allow(w, r, http.MethodGet, http.MethodHead, http.MethodPatch, http.MethodPut, http.MethodDelete) {
		return
	}
	ctx := r.Context()
	var g store.Game
	var err error
	switch r.Method {
	case http.MethodDelete:
		if err := h.cfg.Library.Delete(ctx, user, id); err != nil {
			h.fail(w, r, err)
		} else {
			w.WriteHeader(http.StatusNoContent)
		}
		return
	case http.MethodPatch, http.MethodPut:
		var body struct {
			Title string `json:"title"`
		}
		if err = readJSON(w, r, 4096, &body); err == nil {
			g, err = h.cfg.Library.Rename(ctx, user, id, body.Title)
		}
	default:
		g, err = h.cfg.Library.Get(ctx, user, id)
	}
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, r, http.StatusOK, h.gameView(g))
}

func (h *Handler) favorite(w http.ResponseWriter, r *http.Request, user fnos.User, id string) {
	if !allow(w, r, http.MethodPost, http.MethodPut) {
		return
	}
	var body struct {
		Favorite *bool `json:"favorite"`
	}
	if err := readJSON(w, r, 4096, &body); err != nil {
		h.fail(w, r, err)
		return
	}
	if body.Favorite == nil {
		h.fail(w, r, store.ErrInvalid)
		return
	}
	g, err := h.cfg.Library.Favorite(r.Context(), user, id, *body.Favorite)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, r, http.StatusOK, h.gameView(g))
}

func (h *Handler) launch(w http.ResponseWriter, r *http.Request, user fnos.User, id string) {
	if !allow(w, r, http.MethodGet, http.MethodHead, http.MethodPost) {
		return
	}
	if r.Method == http.MethodPost {
		g, err := h.cfg.Library.Launch(r.Context(), user, id)
		if err != nil {
			h.fail(w, r, err)
			return
		}
		writeJSON(w, r, http.StatusOK, map[string]any{"game": h.gameView(g), "keyboard": g.Keyboard,
			"romUrl": h.prefix() + "/api/games/" + id + "/launch", "core": h.core()})
		return
	}
	g, f, err := h.cfg.Library.Open(r.Context(), user, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("ETag", `"`+g.SHA256+`"`)
	http.ServeContent(w, r, "game.nes", time.Time{}, f)
}
