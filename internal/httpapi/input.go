package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"strings"

	"xiaoniubawang/internal/store"
)

func mediaType(r *http.Request, want string) bool {
	v := r.Header.Values("Content-Type")
	if len(v) != 1 {
		return false
	}
	got, _, err := mime.ParseMediaType(v[0])
	return err == nil && got == want
}

func readJSON(w http.ResponseWriter, r *http.Request, limit int64, into any) error {
	if !mediaType(r, "application/json") {
		return errMediaType
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		return err
	}
	d := json.NewDecoder(strings.NewReader(string(data)))
	d.DisallowUnknownFields()
	if err := d.Decode(into); err != nil {
		return store.ErrInvalid
	}
	if d.Decode(new(any)) != io.EOF {
		return store.ErrInvalid
	}
	return nil
}

func multipartBody(w http.ResponseWriter, r *http.Request, max int64) (*multipart.Reader, error) {
	v := r.Header.Values("Content-Type")
	if len(v) != 1 {
		return nil, errMediaType
	}
	kind, params, err := mime.ParseMediaType(v[0])
	if err != nil || kind != "multipart/form-data" || params["boundary"] == "" || len(params["boundary"]) > 70 {
		return nil, errMediaType
	}
	if r.ContentLength > max {
		return nil, store.ErrTooLarge
	}
	r.Body = http.MaxBytesReader(w, r.Body, max)
	return multipart.NewReader(r.Body, params["boundary"]), nil
}

// Read the unmodified filename. multipart.Part.FileName strips paths, which
// makes it impossible to distinguish a filename from an attempted path.
func partInfo(p *multipart.Part) (field, filename string, file bool, err error) {
	v := p.Header.Values("Content-Disposition")
	if len(v) != 1 || p.Header.Get("Content-Transfer-Encoding") != "" {
		return "", "", false, store.ErrInvalid
	}
	kind, params, err := mime.ParseMediaType(v[0])
	if err != nil || kind != "form-data" || params["name"] == "" {
		return "", "", false, store.ErrInvalid
	}
	filename, file = params["filename"]
	return params["name"], filename, file, nil
}

func readPart(p io.Reader, limit int64) ([]byte, error) {
	v, err := io.ReadAll(io.LimitReader(p, limit+1))
	if err != nil {
		return nil, multipartError(err)
	}
	if int64(len(v)) > limit {
		return nil, store.ErrTooLarge
	}
	return v, nil
}

func multipartError(err error) error {
	var size *http.MaxBytesError
	if errors.As(err, &size) || errors.Is(err, multipart.ErrMessageTooLarge) {
		return store.ErrTooLarge
	}
	return store.ErrInvalid
}
