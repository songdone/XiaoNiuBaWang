package library

import (
	"encoding/binary"
	"errors"
	"io"
	"strings"
	"unicode"
	"unicode/utf8"

	"xiaoniubawang/internal/store"
)

const MaxROMSize = int64(8 << 20)
const MaxUploads = 8

var ErrInvalidROM = errors.New("invalid NES ROM header or payload length")

type headerInfo struct {
	Mapper int
	Format string
}

func parseROM(r io.Reader, size int64) (headerInfo, error) {
	var h [16]byte
	if _, err := io.ReadFull(r, h[:]); err != nil || string(h[:4]) != "NES\x1a" {
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
	if size < 16 || size > MaxROMSize || prg == 0 || prg > uint64(MaxROMSize) || chr > uint64(MaxROMSize) || minSize+prg+chr > uint64(size) {
		return headerInfo{}, ErrInvalidROM
	}
	// Input may include trailing padding or NES 2.0 miscellaneous ROM data.
	return out, nil
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
