package fnos

import (
	"encoding/binary"
	"encoding/hex"
	"errors"
	"os"
	"testing"
)

type aclTestEntry struct {
	tag, perm uint16
	id        uint32
}

func aclTestData(entries ...aclTestEntry) []byte {
	data := make([]byte, 4+8*len(entries))
	binary.LittleEndian.PutUint32(data, 2)
	for i, entry := range entries {
		offset := 4 + i*8
		binary.LittleEndian.PutUint16(data[offset:], entry.tag)
		binary.LittleEndian.PutUint16(data[offset+2:], entry.perm)
		binary.LittleEndian.PutUint32(data[offset+4:], entry.id)
	}
	return data
}

func recordedACL(t *testing.T) []byte {
	t.Helper()
	// app-directory-acl.json: uid 982, owner 7, named uid 982:7,
	// owning group 5, mask 7, other 5. Linux stat reports mode 0775.
	data, err := hex.DecodeString("0200000001000700ffffffff02000700d603000004000500ffffffff10000700ffffffff20000500ffffffff")
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestGatewayACLWriteSafety(t *testing.T) {
	const undefined = uint32(0xffffffff)
	for _, tc := range []struct {
		name        string
		user        aclTestEntry
		group, mask uint16
		other       uint16
		namedGroup  *aclTestEntry
		mode        os.FileMode
		want        bool
	}{
		{"recorded package user", aclTestEntry{2, 7, 982}, 5, 7, 5, nil, 0775, true},
		{"root user", aclTestEntry{2, 7, 0}, 5, 7, 5, nil, 0775, true},
		{"foreign read execute", aclTestEntry{2, 5, 983}, 5, 7, 5, nil, 0775, true},
		{"foreign write", aclTestEntry{2, 7, 983}, 5, 7, 5, nil, 0775, false},
		{"foreign write masked", aclTestEntry{2, 7, 983}, 5, 5, 5, nil, 0755, true},
		{"owning group write", aclTestEntry{2, 7, 982}, 7, 7, 5, nil, 0775, false},
		{"owning group write masked", aclTestEntry{2, 7, 982}, 7, 5, 5, nil, 0755, true},
		{"named group read execute", aclTestEntry{2, 7, 982}, 5, 7, 5, &aclTestEntry{8, 5, 983}, 0775, true},
		{"named group write", aclTestEntry{2, 7, 982}, 5, 7, 5, &aclTestEntry{8, 7, 983}, 0775, false},
		{"root group write", aclTestEntry{2, 7, 982}, 5, 7, 5, &aclTestEntry{8, 7, 0}, 0775, false},
		{"package group write", aclTestEntry{2, 7, 982}, 5, 7, 5, &aclTestEntry{8, 7, 982}, 0775, false},
		{"named group write masked", aclTestEntry{2, 7, 982}, 5, 5, 5, &aclTestEntry{8, 7, 983}, 0755, true},
		{"other write", aclTestEntry{2, 7, 982}, 5, 7, 7, nil, 0777, false},
		{"other write not masked", aclTestEntry{2, 7, 982}, 5, 5, 7, nil, 0757, false},
		{"owner stat mismatch", aclTestEntry{2, 7, 982}, 5, 7, 5, nil, 0575, false},
		{"mask stat mismatch", aclTestEntry{2, 7, 982}, 5, 7, 5, nil, 0755, false},
		{"other stat mismatch", aclTestEntry{2, 7, 982}, 5, 7, 5, nil, 0770, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			entries := []aclTestEntry{{1, 7, undefined}, tc.user, {4, tc.group, undefined}}
			if tc.namedGroup != nil {
				entries = append(entries, *tc.namedGroup)
			}
			entries = append(entries, aclTestEntry{16, tc.mask, undefined}, aclTestEntry{32, tc.other, undefined})
			if got := gatewayACLWriteSafe(aclTestData(entries...), tc.mode, 982); got != tc.want {
				t.Fatalf("ACL safety = %v, want %v", got, tc.want)
			}
		})
	}
	if !gatewayACLWriteSafe(recordedACL(t), 0775, 982) {
		t.Fatal("exact recorded ACL rejected")
	}
}

func TestGatewayACLRejectsMalformed(t *testing.T) {
	const undefined = uint32(0xffffffff)
	base := []aclTestEntry{{1, 7, undefined}, {2, 7, 982}, {4, 5, undefined}, {16, 7, undefined}, {32, 5, undefined}}
	for _, tc := range []struct {
		name   string
		mutate func([]aclTestEntry) []aclTestEntry
	}{
		{"invalid permissions", func(e []aclTestEntry) []aclTestEntry { e[1].perm = 8; return e }},
		{"unknown tag", func(e []aclTestEntry) []aclTestEntry { e[1].tag = 3; return e }},
		{"zero tag", func(e []aclTestEntry) []aclTestEntry { e[0].tag = 0; return e }},
		{"undefined named uid", func(e []aclTestEntry) []aclTestEntry { e[1].id = undefined; return e }},
		{"undefined named gid", func(e []aclTestEntry) []aclTestEntry { e[1].tag = 8; e[1].id = undefined; return e }},
		{"owner with id", func(e []aclTestEntry) []aclTestEntry { e[0].id = 982; return e }},
		{"group owner with id", func(e []aclTestEntry) []aclTestEntry { e[2].id = 982; return e }},
		{"mask with id", func(e []aclTestEntry) []aclTestEntry { e[3].id = 982; return e }},
		{"other with id", func(e []aclTestEntry) []aclTestEntry { e[4].id = 982; return e }},
		{"missing owner", func(e []aclTestEntry) []aclTestEntry { return e[1:] }},
		{"missing owning group", func(e []aclTestEntry) []aclTestEntry { return append(e[:2], e[3:]...) }},
		{"missing mask", func(e []aclTestEntry) []aclTestEntry { return append(e[:3], e[4:]...) }},
		{"missing other", func(e []aclTestEntry) []aclTestEntry { return e[:4] }},
		{"duplicate owner", func(e []aclTestEntry) []aclTestEntry { return append([]aclTestEntry{e[0]}, e...) }},
		{"duplicate user", func(e []aclTestEntry) []aclTestEntry { return append(e[:2], append([]aclTestEntry{e[1]}, e[2:]...)...) }},
		{"duplicate owning group", func(e []aclTestEntry) []aclTestEntry { return append(e[:3], append([]aclTestEntry{e[2]}, e[3:]...)...) }},
		{"duplicate mask", func(e []aclTestEntry) []aclTestEntry { return append(e[:4], append([]aclTestEntry{e[3]}, e[4:]...)...) }},
		{"duplicate other", func(e []aclTestEntry) []aclTestEntry { return append(e, e[4]) }},
		{"duplicate named group", func(e []aclTestEntry) []aclTestEntry {
			return append(e[:3], append([]aclTestEntry{{8, 5, 982}, {8, 5, 982}}, e[3:]...)...)
		}},
		{"out of order tags", func(e []aclTestEntry) []aclTestEntry { e[1], e[2] = e[2], e[1]; return e }},
		{"out of order users", func(e []aclTestEntry) []aclTestEntry {
			return append(e[:2], append([]aclTestEntry{{2, 5, 0}}, e[2:]...)...)
		}},
		{"out of order groups", func(e []aclTestEntry) []aclTestEntry {
			return append(e[:3], append([]aclTestEntry{{8, 5, 983}, {8, 5, 982}}, e[3:]...)...)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			entries := tc.mutate(append([]aclTestEntry(nil), base...))
			if gatewayACLWriteSafe(aclTestData(entries...), 0775, 982) {
				t.Fatal("malformed ACL accepted")
			}
		})
	}
	data := recordedACL(t)
	for length := 0; length < len(data); length++ {
		if gatewayACLWriteSafe(data[:length], 0775, 982) {
			t.Fatalf("truncated ACL of length %d accepted", length)
		}
	}
	for _, version := range []uint32{0, 1, 3, 0xffffffff} {
		binary.LittleEndian.PutUint32(data, version)
		if gatewayACLWriteSafe(data, 0775, 982) {
			t.Fatalf("unknown ACL version %d accepted", version)
		}
	}
	if gatewayACLWriteSafe(append(recordedACL(t), 0), 0775, 982) || gatewayACLWriteSafe(make([]byte, 65540), 0775, 982) {
		t.Fatal("invalid ACL length accepted")
	}
}

func TestGatewayDirectorySafety(t *testing.T) {
	for _, tc := range []struct {
		name       string
		mode       os.FileMode
		owner      uint32
		acl        []byte
		err        error
		want, read bool
	}{
		{"private package directory", os.ModeDir | 0700, 982, nil, nil, true, false},
		{"readonly group and others", os.ModeDir | 0755, 982, nil, nil, true, false},
		{"trusted root owner", os.ModeDir | 0755, 0, nil, nil, true, false},
		{"recorded ACL", os.ModeDir | 0775, 982, recordedACL(t), nil, true, true},
		{"root owner with recorded ACL", os.ModeDir | 0775, 0, recordedACL(t), nil, true, true},
		{"foreign owner", os.ModeDir | 0775, 983, recordedACL(t), nil, false, false},
		{"foreign owner without ACL", os.ModeDir | 0755, 983, nil, nil, false, false},
		{"not a directory", 0775, 982, recordedACL(t), nil, false, false},
		{"other write", os.ModeDir | 0777, 982, recordedACL(t), nil, false, false},
		{"non ACL group write", os.ModeDir | 0775, 982, nil, nil, false, true},
		{"ACL read error", os.ModeDir | 0775, 982, recordedACL(t), errors.New("denied"), false, true},
		{"invalid ACL", os.ModeDir | 0775, 982, []byte("not a POSIX ACL"), nil, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var read bool
			got := gatewayDirectorySafe(tc.mode, tc.owner, 982, func() ([]byte, error) {
				read = true
				return tc.acl, tc.err
			})
			if got != tc.want || read != tc.read {
				t.Fatalf("safety=%v readACL=%v, want safety=%v readACL=%v", got, read, tc.want, tc.read)
			}
		})
	}
}
