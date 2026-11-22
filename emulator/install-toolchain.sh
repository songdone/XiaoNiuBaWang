#!/usr/bin/env bash
# Install the official pinned compiler into this project only; no shell profile changes.
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLCHAIN="$PROJECT_ROOT/build/20261121-core-01/toolchain"
SDK="$TOOLCHAIN/emsdk"
DOWNLOAD="$TOOLCHAIN/downloads/emsdk"
ARCHIVE="$DOWNLOAD/emsdk.tar.gz"
mkdir -p "$DOWNLOAD" "$SDK"
if [[ ! -f "$ARCHIVE" ]]; then
  curl -fL --retry 2 https://codeload.github.com/emscripten-core/emsdk/tar.gz/refs/tags/4.0.20 -o "$ARCHIVE"
fi
python3 -I - "$ARCHIVE" <<'PY'
import hashlib,sys,tarfile
archive=sys.argv[1]
expected='2a8a70eb1c0a47883272a001feb4c7209db6e9bcc36774dd9770050e7ac64fa0'
with open(archive,'rb') as f:
    actual=hashlib.file_digest(f,'sha256').hexdigest() if hasattr(hashlib,'file_digest') else None
if actual is None:
    with open(archive,'rb') as f: actual=hashlib.sha256(f.read()).hexdigest()
if actual!=expected: raise SystemExit('emsdk source checksum mismatch')
with tarfile.open(archive) as t:
    for member in t:
        parts=member.name.split('/')
        if member.name.startswith('/') or '..' in parts or member.issym() or member.islnk():
            raise SystemExit('Unsafe SDK archive path')
print('Verified official emsdk 4.0.20 source archive SHA256 '+actual)
PY
if [[ ! -f "$SDK/emsdk.py" ]]; then
  tar -xzf "$ARCHIVE" --strip-components=1 -C "$SDK"
fi
export EMSDK_KEEP_DOWNLOADS=1
export EMSDK_NOTTY=1
export EMSDK_NUM_CORES="${JOBS:-4}"
python3 -I "$SDK/emsdk.py" install 4.0.20
python3 -I "$SDK/emsdk.py" activate --embedded 4.0.20
printf 'Local toolchain ready at %s\n' "$SDK"
