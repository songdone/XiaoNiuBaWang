package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"strings"
	"syscall"

	"xiaoniubawang/internal/fnos"
)

type Blob struct {
	Key    string
	Size   int64
	SHA256 string
}

func (s *Store) userRoot(user fnos.User, create bool) (*os.Root, error) {
	if !validUser(user) {
		return nil, ErrInvalid
	}
	name := string(user)
	if create {
		if err := s.root.Mkdir(name, 0700); err == nil {
			if err := syncDir(s.root); err != nil {
				return nil, err
			}
		} else if !errors.Is(err, os.ErrExist) {
			return nil, err
		}
	}
	before, err := s.root.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !private(before, true) {
		return nil, ErrCorrupt
	}
	root, err := s.root.OpenRoot(name)
	if err != nil {
		return nil, err
	}
	if after, err := root.Stat("."); err != nil || !os.SameFile(before, after) {
		_ = root.Close()
		return nil, ErrCorrupt
	}
	return root, nil
}

func syncDir(root *os.Root) error {
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func blobKey(key string) bool {
	kind, id, ok := strings.Cut(key, "-")
	return ok && (kind == "rom" || kind == "save" || kind == "cover" || kind == "thumb") && hexToken(id, 32)
}

type cancellableReader struct {
	ctx context.Context
	r   io.Reader
}

func (r cancellableReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.r.Read(p)
}

// WriteBlob uses a new exclusive file for every write. Metadata is published only
// after the file and its directory are durable; no committed file is overwritten.
func (s *Store) WriteBlob(ctx context.Context, user fnos.User, kind string, r io.Reader, limit int64) (blob Blob, err error) {
	if (kind != "rom" && kind != "save" && kind != "cover" && kind != "thumb") || limit <= 0 || r == nil {
		return Blob{}, ErrInvalid
	}
	root, err := s.userRoot(user, true)
	if err != nil {
		return Blob{}, err
	}
	defer root.Close()
	key := kind + "-" + NewID()
	f, err := root.OpenFile(key, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return Blob{}, err
	}
	defer func() {
		_ = f.Close()
		if err != nil {
			_ = root.Remove(key)
		}
	}()
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(cancellableReader{ctx, r}, limit+1))
	if err != nil {
		return Blob{}, err
	}
	if n > limit {
		return Blob{}, ErrTooLarge
	}
	if n == 0 {
		return Blob{}, ErrInvalid
	}
	if err := f.Sync(); err != nil {
		return Blob{}, err
	}
	if err := f.Close(); err != nil {
		return Blob{}, err
	}
	if err := syncDir(root); err != nil {
		return Blob{}, err
	}
	return Blob{Key: key, Size: n, SHA256: hex.EncodeToString(h.Sum(nil))}, nil
}

func (s *Store) OpenBlob(ctx context.Context, user fnos.User, blob Blob) (*os.File, error) {
	if !blobKey(blob.Key) {
		return nil, ErrCorrupt
	}
	root, err := s.userRoot(user, false)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	file, err := root.OpenFile(blob.Key, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	if info, err := file.Stat(); err != nil || !private(info, false) {
		_ = file.Close()
		return nil, ErrCorrupt
	}
	if err := VerifyBlob(ctx, file, blob); err != nil {
		_ = file.Close()
		return nil, err
	}
	return file, nil
}

// VerifyBlob checks the opened inode, not path metadata, and rewinds on success.
func VerifyBlob(ctx context.Context, file *os.File, blob Blob) error {
	if !IsSHA256(blob.SHA256) || blob.Size <= 0 {
		return ErrCorrupt
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() != blob.Size {
		return ErrCorrupt
	}
	h := sha256.New()
	n, err := io.Copy(h, io.LimitReader(cancellableReader{ctx, file}, blob.Size+1))
	if err != nil {
		return err
	}
	if n != blob.Size || hex.EncodeToString(h.Sum(nil)) != blob.SHA256 {
		return ErrCorrupt
	}
	_, err = file.Seek(0, io.SeekStart)
	return err
}

func (s *Store) RemoveBlob(user fnos.User, key string) error {
	if !blobKey(key) {
		return ErrInvalid
	}
	root, err := s.userRoot(user, false)
	if err != nil {
		return err
	}
	defer root.Close()
	return root.Remove(key)
}
