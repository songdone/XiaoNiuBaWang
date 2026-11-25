package library

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"path"
	"strings"
	"unicode"
	"unicode/utf8"

	"xiaoniubawang/internal/store"
)

const MaxROMSize = int64(8 << 20)
const MaxZipROMSize = MaxROMSize + (64 << 10)
const MaxZipEntries = 64
const MaxUploads = 8

var ErrInvalidROM = errors.New("invalid NES ROM header or payload length")

type headerInfo struct {
	Mapper  int
	Format  string
	MinSize uint64
}

func parseROMHeader(h [16]byte) (headerInfo, error) {
	if string(h[:4]) != "NES\x1a" {
		return headerInfo{}, ErrInvalidROM
	}
	out := headerInfo{Mapper: int(h[6]>>4 | h[7]&0xf0), Format: "iNES"}
	prg, chr := uint64(h[4])*16384, uint64(h[5])*8192
	if h[7]&0x0c == 0x08 {
		out.Format = "NES 2.0"
		out.Mapper |= int(h[8]&0x0f) << 8
		prg = nes2Size(h[4], h[9]&0x0f, 16384)
		chr = nes2Size(h[5], h[9]>>4, 8192)
	} else if binary.LittleEndian.Uint32(h[12:]) != 0 {
		// Some older iNES ROMs have junk in the reserved bytes. The high
		// mapper nibble cannot reliably be used in that case.
		out.Mapper = int(h[6] >> 4)
	}
	minSize := uint64(len(h))
	if h[6]&4 != 0 {
		minSize += 512
	}
	if prg == 0 || prg > uint64(MaxROMSize) || chr > uint64(MaxROMSize) || minSize+prg+chr > uint64(MaxROMSize) {
		return headerInfo{}, ErrInvalidROM
	}
	out.MinSize = minSize + prg + chr
	return out, nil
}

func parseROM(r io.Reader, size int64) (headerInfo, error) {
	var h [16]byte
	if _, err := io.ReadFull(r, h[:]); err != nil {
		return headerInfo{}, ErrInvalidROM
	}
	out, err := parseROMHeader(h)
	if err != nil {
		return headerInfo{}, err
	}
	if size < 16 || size > MaxROMSize || out.MinSize > uint64(size) {
		return headerInfo{}, ErrInvalidROM
	}
	// Input may include trailing padding or NES 2.0 miscellaneous ROM data.
	return out, nil
}

// ExtractSingleROMFromZip safely unpacks a bounded archive containing exactly
// one regular .nes ROM. Encrypted archives, links, path traversal, zip bombs,
// and multi-ROM bundles are rejected.
func ExtractSingleROMFromZip(r io.Reader) (string, []byte, error) {
	raw, err := io.ReadAll(io.LimitReader(r, MaxZipROMSize+1))
	if err != nil {
		return "", nil, err
	}
	if int64(len(raw)) > MaxZipROMSize {
		return "", nil, store.ErrTooLarge
	}
	if len(raw) < 22 {
		return "", nil, ErrInvalidROM
	}
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil || len(zr.File) == 0 || len(zr.File) > MaxZipEntries {
		return "", nil, ErrInvalidROM
	}
	var candidate *zip.File
	var candidateName string
	for _, f := range zr.File {
		if f.Flags&1 != 0 {
			return "", nil, ErrInvalidROM
		}
		if f.FileInfo().IsDir() {
			continue
		}
		name := f.Name
		if name == "" || strings.ContainsAny(name, "\\:\x00") || path.IsAbs(name) {
			return "", nil, ErrInvalidROM
		}
		clean := path.Clean(name)
		if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || strings.Contains(clean, "/../") {
			return "", nil, ErrInvalidROM
		}
		if strings.HasPrefix(clean, "__MACOSX/") {
			continue
		}
		base := path.Base(clean)
		if strings.HasPrefix(base, "._") {
			continue
		}
		if !strings.EqualFold(path.Ext(base), ".nes") {
			continue
		}
		if f.Mode()&0o170000 != 0 && !f.Mode().IsRegular() {
			return "", nil, ErrInvalidROM
		}
		if !SafeFilename(base) {
			return "", nil, ErrInvalidROM
		}
		if candidate != nil {
			// Require exactly one .nes file so zip bundles are unambiguous.
			return "", nil, ErrInvalidROM
		}
		candidate = f
		candidateName = base
	}
	if candidate == nil {
		return "", nil, ErrInvalidROM
	}
	if candidate.UncompressedSize64 < 16 || candidate.UncompressedSize64 > uint64(MaxROMSize) {
		return "", nil, ErrInvalidROM
	}
	rc, err := candidate.Open()
	if err != nil {
		return "", nil, ErrInvalidROM
	}
	defer rc.Close()
	data, err := io.ReadAll(io.LimitReader(rc, MaxROMSize+1))
	if err != nil {
		return "", nil, ErrInvalidROM
	}
	if int64(len(data)) > MaxROMSize {
		return "", nil, store.ErrTooLarge
	}
	if uint64(len(data)) != candidate.UncompressedSize64 {
		return "", nil, ErrInvalidROM
	}
	if _, err := parseROM(bytes.NewReader(data), int64(len(data))); err != nil {
		return "", nil, err
	}
	return candidateName, data, nil
}

func nes2Size(lsb, msb uint8, unit uint64) uint64 {
	if msb != 15 {
		return (uint64(msb)<<8 | uint64(lsb)) * unit
	}
	exponent := lsb >> 2
	if exponent > 23 { // Out of our size limit; don't shift or multiply unsafely.
		return uint64(MaxROMSize) + 1
	}
	return (uint64(1) << exponent) * uint64(2*(lsb&3)+1)
}

func SafeFilename(name string) bool {
	return name != "" && name != "." && name != ".." && !strings.HasPrefix(name, ".") && name == strings.TrimSpace(name) &&
		len(name) <= 255 && utf8.ValidString(name) && !strings.ContainsAny(name, "/\\:") && !strings.ContainsFunc(name, unicode.IsControl)
}

func cleanTitle(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 256 || !utf8.ValidString(name) || strings.ContainsFunc(name, unicode.IsControl) {
		return "", store.ErrInvalid
	}
	return name, nil
}
