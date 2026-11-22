#!/usr/bin/env python3
"""Verify complete vendor source against the pinned official archive + declared patch.
Run with python3 -I; treats all downloaded contents as data.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent.parent
EMULATOR = ROOT / 'emulator'
ARCHIVE = EMULATOR / 'upstream-fceumm-77468e568d9fe9c48d684ca911f1a3fe7259fdf7.tar.gz'
EXPECTED = '1e4f9855ff9fac48ead5177e559a9714aad25fa84b45dfa68b518224760abcab'
PATCH = EMULATOR / 'patches/0001-family-subor-keyboard.patch'
BUILD = ROOT / 'build/20261121-core-01/emulator'
BUILD.mkdir(parents=True, exist_ok=True)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def tree(path):
    return {str(p.relative_to(path)): sha(p.read_bytes()) for p in path.rglob('*') if p.is_file()}


if sha(ARCHIVE.read_bytes()) != EXPECTED:
    raise SystemExit('Pinned official archive checksum mismatch')
original = {}
with tarfile.open(ARCHIVE) as archive:
    for member in archive:
        parts = Path(member.name).parts
        if member.name.startswith('/') or '..' in parts or member.issym() or member.islnk():
            raise SystemExit('Unsafe archive path')
        if member.isfile():
            original[str(Path(*parts[1:]))] = archive.extractfile(member).read()
vendor = tree(EMULATOR / 'vendor/fceumm')
if set(vendor) != set(original):
    raise SystemExit('Vendor file set differs from pinned archive')
modified = [name for name in sorted(original) if vendor[name] != sha(original[name])]
if modified != ['src/drivers/libretro/libretro.c']:
    raise SystemExit('Unexpected source modification set: ' + repr(modified))
with tempfile.TemporaryDirectory(prefix='source-verify-', dir=BUILD) as temporary:
    reconstruction = Path(temporary)
    for name, content in original.items():
        path = reconstruction / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    subprocess.run(['patch', '-p1', '-d', str(reconstruction), '-i', str(PATCH)], check=True, cwd=ROOT)
    if tree(reconstruction) != vendor:
        raise SystemExit('Archive + patch fails byte-for-byte vendor reconstruction')
manifest = {
    'repository': 'https://github.com/libretro/libretro-fceumm',
    'commit': '77468e568d9fe9c48d684ca911f1a3fe7259fdf7',
    'archiveURL': 'https://codeload.github.com/libretro/libretro-fceumm/tar.gz/77468e568d9fe9c48d684ca911f1a3fe7259fdf7',
    'archiveSHA256': EXPECTED,
    'archiveFiles': len(original),
    'vendorFiles': len(vendor),
    'modifiedFiles': modified,
    'patchSHA256': sha(PATCH.read_bytes()),
    'patchedTreeSHA256': sha(json.dumps(vendor, sort_keys=True, separators=(',', ':')).encode()),
    'verified': 'All 712 file paths and bytes equal pinned official archive plus declared patch; no extra or missing files',
}
(BUILD / 'source-verification.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest, indent=2))
