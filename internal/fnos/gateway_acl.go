package fnos

import (
	"encoding/binary"
	"os"
)

const (
	aclUserOwner          = 0x01
	aclUser               = 0x02
	aclGroupOwner         = 0x04
	aclGroup              = 0x08
	aclMask               = 0x10
	aclOther              = 0x20
	aclUndefinedID uint32 = 0xffffffff
)

// PackageAssetWriteSafe proves that an installed regular file or directory can
// only be written by root or the package UID. Linux may expose an ACL mask as
// group-write stat bits; that is accepted only with a valid effective-writer ACL.
// The caller must open without following links and read the ACL from that same
// descriptor. This does not replace content, inode/link or path validation.
func PackageAssetWriteSafe(mode os.FileMode, owner, uid uint32, readACL func() ([]byte, error)) bool {
	if (!mode.IsDir() && !mode.IsRegular()) || mode&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 || owner != 0 && owner != uid || mode.Perm()&0002 != 0 {
		return false
	}
	if mode.Perm()&0020 == 0 {
		return true
	}
	acl, err := readACL()
	return err == nil && gatewayACLWriteSafe(acl, mode, uid)
}

func gatewayDirectorySafe(mode os.FileMode, owner, uid uint32, readACL func() ([]byte, error)) bool {
	if !mode.IsDir() || owner != 0 && owner != uid || mode.Perm()&0002 != 0 {
		return false
	}
	if mode.Perm()&0020 == 0 {
		return true
	}
	// On Linux the stat group bits represent the ACL mask, not necessarily
	// the owning group's permissions. Only a validated access ACL can prove
	// that a writable mask does not grant write to an untrusted principal.
	acl, err := readACL()
	return err == nil && gatewayACLWriteSafe(acl, mode, uid)
}

// gatewayACLWriteSafe parses the Linux POSIX access ACL xattr (version 2,
// little-endian header and 8-byte entries). The caller verifies the owner is
// root or the package UID. Owner permissions are not limited by the ACL mask;
// named users, the owning group and named groups are all limited by it.
func gatewayACLWriteSafe(data []byte, mode os.FileMode, uid uint32) bool {
	if len(data) < 4+4*8 || len(data) > 65536 || (len(data)-4)%8 != 0 || binary.LittleEndian.Uint32(data[:4]) != 2 {
		return false
	}
	var seen, previousTag uint16
	var previousID uint32
	var ownerPerm, groupPerm, maskPerm, otherPerm uint16
	var untrustedWrite bool
	for offset := 4; offset < len(data); offset += 8 {
		tag := binary.LittleEndian.Uint16(data[offset:])
		perm := binary.LittleEndian.Uint16(data[offset+2:])
		id := binary.LittleEndian.Uint32(data[offset+4:])
		if perm&^uint16(7) != 0 || tag < previousTag {
			return false
		}
		if tag == aclUser || tag == aclGroup {
			if id == aclUndefinedID || tag == previousTag && id <= previousID {
				return false
			}
		} else if id != aclUndefinedID || seen&tag != 0 {
			return false
		}
		switch tag {
		case aclUserOwner:
			ownerPerm = perm
		case aclUser:
			untrustedWrite = untrustedWrite || perm&2 != 0 && id != 0 && id != uid
		case aclGroupOwner:
			groupPerm = perm
		case aclGroup:
			// No group identity is trusted, even root's or the package's group.
			untrustedWrite = untrustedWrite || perm&2 != 0
		case aclMask:
			maskPerm = perm
		case aclOther:
			otherPerm = perm
		default:
			return false
		}
		seen |= tag
		previousTag, previousID = tag, id
	}
	if seen&(aclUserOwner|aclGroupOwner|aclMask|aclOther) != aclUserOwner|aclGroupOwner|aclMask|aclOther {
		return false
	}
	// Refuse an ACL inconsistent with the stat snapshot as well as unsafe ACLs.
	return os.FileMode(ownerPerm) == mode.Perm()>>6 &&
		os.FileMode(maskPerm) == mode.Perm()>>3&7 &&
		os.FileMode(otherPerm) == mode.Perm()&7 &&
		otherPerm&2 == 0 && groupPerm&maskPerm&2 == 0 &&
		(!untrustedWrite || maskPerm&2 == 0)
}
