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
	"xiaoniubawang/internal/saves"
	"xiaoniubawang/internal/store"
)

type saveResponse struct {
	store.Save
	URL string `json:"url"`
}

func (h *Handler) saveView(slot store.Save) saveResponse {
	return saveResponse{slot, h.prefix() + "/api/saves/" + slot.ID}
}

func queryOne(r *http.Request, key string) (string, bool) {
	q, err := url.ParseQuery(r.URL.RawQuery)
	return q.Get(key), err == nil && len(q) == 1 && len(q[key]) == 1
}

func (h *Handler) saveCollection(w http.ResponseWriter, r *http.Request, user fnos.User) {
	if !allow(w, r, http.MethodGet, http.MethodHead, http.MethodPost) {
		return
	}
	if r.Method == http.MethodPost {
		h.createSave(w, r, user)
		return
	}
	gameID, ok := queryOne(r, "game")
	if !ok || !store.ValidID(gameID) {
		h.fail(w, r, store.ErrInvalid)
		return
	}
	slots, err := h.saves.List(r.Context(), user, gameID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	out := make([]saveResponse, 0, len(slots))
	for _, slot := range slots {
		out = append(out, h.saveView(slot))
	}
	writeJSON(w, r, http.StatusOK, map[string]any{"saves": out})
}

func (h *Handler) createSave(w http.ResponseWriter, r *http.Request, user fnos.User) {
	if !h.uploading(w, r) {
		return
	}
	defer func() { <-h.uploads }()
	m, err := multipartBody(w, r, saves.MaxState+(64<<10))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	var data []byte
	fields := make(map[string]string)
	for {
		p, err := m.NextRawPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			h.fail(w, r, multipartError(err))
			return
		}
		field, _, file, err := partInfo(p)
		if err != nil {
			h.fail(w, r, err)
			return
		}
		if field == "file" && file && data == nil {
			data, err = readPart(p, saves.MaxState)
			if err != nil {
				h.fail(w, r, err)
				return
			}
			continue
		}
		switch field {
		case "gameId", "kind", "slot", "core", "coreVersion", "romSha256", "sha256":
		default:
			h.fail(w, r, store.ErrInvalid)
			return
		}
		if _, exists := fields[field]; exists || file {
			h.fail(w, r, store.ErrInvalid)
			return
		}
		v, err := readPart(p, 256)
		if err != nil {
			h.fail(w, r, err)
			return
		}
		fields[field] = string(v)
	}
	n, err := strconv.Atoi(fields["slot"])
	if err != nil || strconv.Itoa(n) != fields["slot"] || len(data) == 0 {
		h.fail(w, r, store.ErrInvalid)
		return
	}
	slot, err := h.saves.Create(r.Context(), user, saves.Input{GameID: fields["gameId"], Kind: fields["kind"], Slot: n,
		Core: fields["core"], CoreVersion: fields["coreVersion"], ROMSHA256: fields["romSha256"], SHA256: fields["sha256"]}, bytes.NewReader(data))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	out := h.saveView(slot)
	w.Header().Set("ETag", slot.ETag)
	w.Header().Set("Location", out.URL)
	writeJSON(w, r, http.StatusCreated, out)
}

func (h *Handler) save(w http.ResponseWriter, r *http.Request, user fnos.User, id string) {
	if !store.ValidID(id) {
		h.fail(w, r, store.ErrInvalid)
		return
	}
	if !allow(w, r, http.MethodGet, http.MethodHead, http.MethodPut, http.MethodDelete) {
		return
	}
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		h.getSave(w, r, user, id)
		return
	}
	// Require the exact single strong validator. Weak and wildcard validators
	// must not silently turn an optimistic update into an unconditional write.
	match := r.Header.Values("If-Match")
	if len(match) == 0 {
		problem(w, r, http.StatusPreconditionRequired, "if_match_required", "缺少存档版本，请刷新后重试。")
		return
	}
	if len(match) != 1 || len(match[0]) < 2 || len(match[0]) > 128 || match[0][0] != '"' || match[0][len(match[0])-1] != '"' || strings.ContainsAny(match[0][1:len(match[0])-1], "\",\\\t ") {
		h.fail(w, r, store.ErrInvalid)
		return
	}
	ctx := r.Context()
	if r.Method == http.MethodDelete {
		if err := h.saves.Delete(ctx, user, id, match[0]); err != nil {
			h.fail(w, r, err)
		} else {
			w.WriteHeader(http.StatusNoContent)
		}
		return
	}
	if !mediaType(r, "application/octet-stream") {
		h.fail(w, r, errMediaType)
		return
	}
	if !h.uploading(w, r) {
		return
	}
	defer func() { <-h.uploads }()
	assertions := saves.Assertions{}
	for k, dst := range map[string]*string{"X-XNBW-Core": &assertions.Core, "X-XNBW-Core-Version": &assertions.CoreVersion,
		"X-XNBW-ROM-SHA256": &assertions.ROMSHA256, "X-XNBW-SHA256": &assertions.SHA256} {
		v := r.Header.Values(k)
		if len(v) > 1 || len(v) == 1 && (v[0] == "" || len(v[0]) > 96) {
			h.fail(w, r, store.ErrInvalid)
			return
		}
		if len(v) == 1 {
			*dst = v[0]
		}
	}
	if r.ContentLength > saves.MaxState {
		h.fail(w, r, store.ErrTooLarge)
		return
	}
	slot, err := h.saves.Update(ctx, user, id, match[0], assertions, http.MaxBytesReader(w, r.Body, saves.MaxState))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	w.Header().Set("ETag", slot.ETag)
	writeJSON(w, r, http.StatusOK, h.saveView(slot))
}

func (h *Handler) getSave(w http.ResponseWriter, r *http.Request, user fnos.User, id string) {
	if r.URL.RawQuery != "" {
		value, ok := queryOne(r, "metadata")
		if !ok || value != "1" {
			h.fail(w, r, store.ErrInvalid)
			return
		}
		slot, err := h.saves.Get(r.Context(), user, id)
		if err != nil {
			h.fail(w, r, err)
			return
		}
		w.Header().Set("ETag", slot.ETag)
		writeJSON(w, r, http.StatusOK, h.saveView(slot))
		return
	}
	slot, f, err := h.saves.Open(r.Context(), user, id)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	defer f.Close()
	w.Header().Set("ETag", slot.ETag)
	w.Header().Set("X-XNBW-SHA256", slot.SHA256)
	w.Header().Set("X-XNBW-ROM-SHA256", slot.ROMSHA256)
	w.Header().Set("X-XNBW-Core", slot.Core)
	w.Header().Set("X-XNBW-Core-Version", slot.CoreVersion)
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeContent(w, r, "snapshot.bin", time.Time{}, f)
}
