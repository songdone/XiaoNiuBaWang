#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
umask 077
fail() {
    printf '%s\n' "$1" >&2
    if [ -n "${TRIM_TEMP_LOGFILE:-}" ]; then printf '%s\n' "$1" >> "$TRIM_TEMP_LOGFILE" || true; fi
    exit 1
}
[ -n "${TRIM_PKGVAR:-}" ] || fail '缺少飞牛应用数据目录配置。'
case "$TRIM_PKGVAR" in /*) ;; *) fail '应用数据目录必须是绝对路径。' ;; esac
[ "$TRIM_PKGVAR" != / ] || fail '应用数据目录不能是根目录。'
for directory in "$TRIM_PKGVAR" "$TRIM_PKGVAR/xiaoniubawang-data" "$TRIM_PKGVAR/logs" "$TRIM_PKGVAR/tmp"; do
    [ ! -L "$directory" ] && { [ ! -e "$directory" ] || [ -d "$directory" ]; } || fail '应用数据路径不是安全目录。'
    if [ "${1:-check}" = prepare ]; then
        mkdir -p -- "$directory" || fail '无法创建应用数据目录，请检查目录权限。'
        chmod 700 "$directory" || fail '无法设置应用数据目录权限。'
    fi
done
# No hook removes application data. The platform's uninstall retention behavior
# is not guaranteed; the wizard requires an external backup before uninstall.
