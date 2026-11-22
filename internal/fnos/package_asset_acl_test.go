package fnos

import (
	"errors"
	"os"
	"testing"
)

func TestPackageAssetWriteSafeInstalledMask0775(t *testing.T) {
	const uid = 982
	undefined := uint32(0xffffffff)
	entries := []aclTestEntry{{1, 7, undefined}, {2, 7, uid}, {4, 5, undefined}, {16, 7, undefined}, {32, 5, undefined}}
	for _, directory := range []bool{false, true} {
		mode := os.FileMode(0775)
		if directory {
			mode |= os.ModeDir
		}
		for _, owner := range []uint32{0, uid} {
			if !PackageAssetWriteSafe(mode, owner, uid, func() ([]byte, error) { return aclTestData(entries...), nil }) {
				t.Fatalf("recorded installed 0775 ACL rejected directory=%v owner=%d", directory, owner)
			}
		}
		cases := []struct {
			name  string
			data  []aclTestEntry
			mode  os.FileMode
			owner uint32
		}{
			{"foreign owner", entries, mode, 983},
			{"foreign user writer", []aclTestEntry{{1, 7, undefined}, {2, 7, 983}, {4, 5, undefined}, {16, 7, undefined}, {32, 5, undefined}}, mode, uid},
			{"owning group writer", []aclTestEntry{{1, 7, undefined}, {2, 7, uid}, {4, 7, undefined}, {16, 7, undefined}, {32, 5, undefined}}, mode, uid},
			{"named package group writer", []aclTestEntry{{1, 7, undefined}, {2, 7, uid}, {4, 5, undefined}, {8, 7, uid}, {16, 7, undefined}, {32, 5, undefined}}, mode, uid},
			{"other writer", []aclTestEntry{{1, 7, undefined}, {2, 7, uid}, {4, 5, undefined}, {16, 7, undefined}, {32, 7, undefined}}, mode | 2, uid},
			{"setid", entries, mode | os.ModeSetgid, uid},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				if PackageAssetWriteSafe(tc.mode, tc.owner, uid, func() ([]byte, error) { return aclTestData(tc.data...), nil }) {
					t.Fatal("unsafe installed support ACL accepted")
				}
			})
		}
		for _, data := range [][]byte{nil, []byte("malformed ACL")} {
			if PackageAssetWriteSafe(mode, uid, uid, func() ([]byte, error) { return data, nil }) {
				t.Fatal("0775 accepted without a validated effective ACL")
			}
		}
		if PackageAssetWriteSafe(mode, uid, uid, func() ([]byte, error) { return nil, errors.New("denied") }) {
			t.Fatal("ACL read failure accepted")
		}
	}
	for _, mode := range []os.FileMode{0600, 0644, os.ModeDir | 0755} {
		if !PackageAssetWriteSafe(mode, uid, uid, func() ([]byte, error) { t.Fatal("nonwritable mask does not need ACL"); return nil, nil }) {
			t.Fatal("safe ordinary mode rejected")
		}
	}
	if PackageAssetWriteSafe(os.ModeSymlink|0775, uid, uid, func() ([]byte, error) { return aclTestData(entries...), nil }) {
		t.Fatal("symlink accepted")
	}
}
