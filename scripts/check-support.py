#!/usr/bin/env python3
"""Verify and stage only the user's exact two approved private support originals."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat

ROOT = Path(__file__).resolve().parents[1]
APPROVED_FILES = {
    "wechat-6uos.jpg": {"sha256": "33c845f8464cba9ab14cc923046865de45ddbdc81a6e0f088aaa90bc6719fc94", "bytes": 62806},
    "alipay-6uos.jpg": {"sha256": "1a1a554d645d73467a802f631e415baaa45e1342e5762de75020981e6eadfdc7", "bytes": 108962},
}
DISABLED_NAME = "support-disabled.flag"
DISABLED_BYTES = b"explicit --without-support\n"


def approval():
    path = ROOT / "scripts/support-assets-approved.json"
    regular(path)
    value = json.loads(path.read_text())
    # The version/date describe historical consent, not an application-version
    # entitlement. Approval follows the application identity and exact bytes.
    brand = json.loads((ROOT / "branding/brand.json").read_text())
    if (value.get("schemaVersion"), value.get("application"), brand.get("id"),
        value.get("sourceDirectory"), value.get("packageDirectory"), value.get("sourceArchivePolicy"), value.get("files")) != (
            1, "xiaoniubawang", "xiaoniubawang", "assets/support", "app/support", "exclude-private-payment-images", APPROVED_FILES):
        raise ValueError("Support approval configuration differs from the frozen application approval")
    return value


def regular(path):
    path = Path(path)
    try:
        info = path.lstat()
    except FileNotFoundError:
        raise ValueError(f"Missing approved support file: {path.name}; source-only builds must explicitly use --without-support") from None
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) not in (0o600, 0o644):
        raise ValueError(f"Support file must be a regular, single-link 0600/0644 file: {path.name}")
    return info


def check_directory(directory):
    approval()
    directory = Path(directory)
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("Approved support directory is missing or unsafe; explicitly use --without-support for a source-only build")
    mode = stat.S_IMODE(directory.lstat().st_mode)
    if mode not in (0o700, 0o755):
        raise ValueError("Support directory must have owner-controlled 0700/0755 permissions")
    if {p.name for p in directory.iterdir()} != set(APPROVED_FILES):
        raise ValueError("Support directory must contain exactly the two approved originals, with no additional files or directories")
    result = {}
    for name, expected in APPROVED_FILES.items():
        path = directory / name
        info = regular(path)
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if info.st_size != expected["bytes"] or len(data) != expected["bytes"] or digest != expected["sha256"]:
            raise ValueError(f"Approved support original bytes changed: {name}")
        result[name] = dict(expected, mode=f"{stat.S_IMODE(info.st_mode):04o}")
    return result


def check_stage(stage, without_support=False):
    approval()
    app = Path(stage) / "app"
    directory, disabled = app / "support", app / DISABLED_NAME
    if without_support:
        if directory.exists() or directory.is_symlink():
            raise ValueError("Explicit support-disabled stage must not contain a support directory")
        regular(disabled)
        if disabled.read_bytes() != DISABLED_BYTES:
            raise ValueError("Support-disabled marker does not prove the explicit --without-support build mode")
        return {"enabled": False, "mode": "explicit-without-support", "privateImagesExcludedFromSource": True}
    if disabled.exists() or disabled.is_symlink():
        raise ValueError("Approved default release must not contain a support-disabled marker")
    return {"enabled": True, "directory": "app/support", "files": check_directory(directory),
            "privateImagesExcludedFromSource": True}


def copy_approved(source, destination):
    check_directory(source)
    source, destination = Path(source), Path(destination)
    destination.mkdir(mode=0o755, parents=True, exist_ok=False)
    os.chmod(destination, 0o755)
    for name in APPROVED_FILES:
        with (destination / name).open("xb") as stream:
            stream.write((source / name).read_bytes())
        os.chmod(destination / name, 0o644)
    return check_directory(destination)


def stage_support(stage, frozen_source=None, without_support=False):
    app = Path(stage) / "app"
    app.mkdir(parents=True, exist_ok=True)
    if without_support:
        if (app / "support").exists() or (app / "support").is_symlink():
            raise ValueError("Cannot disable a stage already containing support images")
        with (app / DISABLED_NAME).open("xb") as stream:
            stream.write(DISABLED_BYTES)
        os.chmod(app / DISABLED_NAME, 0o644)
    else:
        if (app / DISABLED_NAME).exists() or (app / DISABLED_NAME).is_symlink():
            raise ValueError("Cannot approve a stage containing a disabled marker")
        copy_approved(frozen_source or ROOT / "assets/support", app / "support")
    return check_stage(stage, without_support)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=ROOT / "assets/support")
    parser.add_argument("--stage", type=Path)
    parser.add_argument("--without-support", action="store_true", help="explicitly validate a support-disabled source-only stage")
    args = parser.parse_args()
    if args.without_support and not args.stage:
        parser.error("--without-support requires --stage; it never approves missing release originals")
    result = check_stage(args.stage, args.without_support) if args.stage else check_directory(args.directory)
    print(json.dumps({"ok": True, "support": result}, ensure_ascii=False, indent=2))
