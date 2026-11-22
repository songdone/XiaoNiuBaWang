#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec python3 -I -B "$script_dir/build.py" "$@"
