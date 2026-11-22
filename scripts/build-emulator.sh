#!/usr/bin/env bash
# Build the pinned upstream FCEUmm core with the standalone GPL-2.0-or-later frontend.
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_ROOT="$PROJECT_ROOT/build/20261121-core-01"
SDK_ROOT="${EMSDK_ROOT:-$BUILD_ROOT/toolchain/emsdk}"
CORE_BUILD="$BUILD_ROOT/emulator/source"
OUT="$PROJECT_ROOT/web/public/cores"
EMCC="$SDK_ROOT/upstream/emscripten/emcc"
EMAR="$SDK_ROOT/upstream/emscripten/emar"
export EM_CONFIG="$SDK_ROOT/.emscripten"
export EM_CACHE="$BUILD_ROOT/toolchain/cache"
export EMSDK_PYTHON="$SDK_ROOT/python/3.13.3_64bit/bin/python3"
export EMSDK_NODE="$SDK_ROOT/node/22.16.0_64bit/bin/node"
if [[ ! -x "$EMCC" ]]; then
  printf 'Missing local Emscripten 4.0.20 at %s\n' "$SDK_ROOT" >&2
  exit 1
fi
mkdir -p "$CORE_BUILD" "$OUT"
# The complete patched corresponding source is shipped under emulator/vendor/fceumm.
rsync -a --delete --exclude='*.o' --exclude='*.bc' "$PROJECT_ROOT/emulator/vendor/fceumm/" "$CORE_BUILD/"
printf 'Compiling pinned FCEUmm WASM core with %s\n' "$EMCC"
make -C "$CORE_BUILD" -f Makefile.libretro -j"${JOBS:-4}" \
  platform=emscripten HAVE_HDPACK=0 HAVE_NTSC=1 \
  CC="$EMCC" AR="$EMAR" 'GIT_VERSION= 77468e5'
# Upstream names its static archive .bc; modern emcc requires the .a suffix.
cp "$CORE_BUILD/fceumm_libretro_emscripten.bc" "$CORE_BUILD/fceumm_libretro.a"
# Static upstream builds normally borrow these libretro-common units from RetroArch.
# Our dedicated frontend supplies the same bundled upstream units directly.
COMMON="$CORE_BUILD/src/drivers/libretro/libretro-common"
COMMON_SOURCES=(
  compat/compat_posix_string.c compat/compat_snprintf.c compat/compat_strcasestr.c
  compat/compat_strl.c compat/fopen_utf8.c encodings/encoding_utf.c
  file/file_path.c file/file_path_io.c streams/file_stream.c
  streams/file_stream_transforms.c string/stdstring.c time/rtime.c
  vfs/vfs_implementation.c
)
COMMON_ARGS=()
for source in "${COMMON_SOURCES[@]}"; do COMMON_ARGS+=("$COMMON/$source"); done
"$EMCC" -O2 -I"$COMMON/include" \
  "$PROJECT_ROOT/emulator/frontend.c" "$CORE_BUILD/fceumm_libretro.a" "${COMMON_ARGS[@]}" -lm \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createFceummModule \
  -sENVIRONMENT=web,node -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 \
  -sSTACK_SIZE=1048576 -sFILESYSTEM=1 -sEXIT_RUNTIME=0 \
  -sEXPORTED_FUNCTIONS='["_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["HEAPU8","HEAP16","UTF8ToString"]' \
  --no-entry -o "$OUT/fceumm-core.mjs"
cp "$PROJECT_ROOT/emulator/runtime.js" "$OUT/fceumm.js"
cp "$PROJECT_ROOT/emulator/runtime.d.ts" "$OUT/fceumm.d.ts"
cp "$PROJECT_ROOT/emulator/licenses/FCEUmm-Copying.txt" "$OUT/FCEUmm-LICENSE.txt"
cp "$PROJECT_ROOT/emulator/licenses/Emscripten-LICENSE.txt" "$OUT/Emscripten-LICENSE.txt"
"$EMCC" --version
shasum -a 256 "$OUT/fceumm-core.wasm" "$OUT/fceumm-core.mjs" "$OUT/fceumm.js"
