#!/usr/bin/env python3
"""Create a deterministic, complete application/core corresponding-source ZIP."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EXCLUDE = {"node_modules", "dist", "build", "artifacts", "test-results", "playwright-report", ".git", "__pycache__", ".vite", ".DS_Store"}
ROOTS = ("cmd", "internal", "web", "branding", "scripts", "packaging", "emulator", "third_party", "tests", "assets/brand", "docs", "distribution")
PRIVATE = re.compile(rb"/Users/[A-Za-z0-9][^/\s\"'<>]+/|/home/[A-Za-z0-9][^/\s\"'<>]+/")
CORE_SOURCE_SHA256 = "a5df940e9fff72a6daee22d898e2dda5a5a9305588e172eb37c53c07f5cd7821"
PRECOMPRESSED_SUFFIXES = frozenset({".zip", ".gz", ".tgz", ".png", ".jpg", ".jpeg", ".webp", ".br", ".xz"})


def resolve_module_cache(go_bin=None):
    env_cache = os.environ.get("GOMODCACHE")
    if env_cache:
        candidate = Path(env_cache).expanduser() / "cache/download"
        if candidate.is_dir():
            return candidate
    go_cmd = str(go_bin) if go_bin else "go"
    try:
        out = subprocess.check_output([go_cmd, "env", "GOMODCACHE"], text=True, stderr=subprocess.DEVNULL).strip()
        if out:
            candidate = Path(out).expanduser() / "cache/download"
            if candidate.is_dir():
                return candidate
    except (OSError, subprocess.SubprocessError):
        pass
    return Path.home() / "go/pkg/mod/cache/download"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def selected_files():
    paths = [ROOT / name for name in ("LICENSE", "go.mod", "go.sum", "README.md", "THIRD_PARTY_NOTICES.md", ".gitignore", ".gitattributes") if (ROOT / name).is_file()]
    for name in ROOTS:
        directory = ROOT / name
        if not directory.is_dir():
            continue
        for current, directories, names in os.walk(directory, followlinks=False):
            parent = Path(current)
            relative_parent = parent.relative_to(ROOT)
            vendored = "vendor" in relative_parent.parts
            directories[:] = sorted(d for d in directories if d not in EXCLUDE and (vendored or not d.startswith(".")))
            for name in sorted(names):
                path = parent / name
                relative = path.relative_to(ROOT)
                if name in EXCLUDE or (name.startswith(".") and not vendored):
                    continue
                if path.is_symlink():
                    raise ValueError(f"Source snapshot refuses symlink: {relative}")
                if not path.is_file() or path.suffix in (".log", ".pyc", ".fpk"):
                    continue
                if path.name == "AGENTS.md" and not vendored:
                    continue
                if any(part in relative.parts for part in ("support", "support-assets", "donation")) or name in ("wechat-6uos.jpg", "alipay-6uos.jpg", "support-disabled.flag"):
                    raise ValueError(f"Private support runtime assets must never enter corresponding source: {relative}")
                paths.append(path)
    return sorted(set(paths))


def application_brand():
    value = json.loads((ROOT / "branding/brand.json").read_text())
    if value.get("id") != "xiaoniubawang" or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?", value.get("version", "")):
        raise ValueError("Invalid application identity or version in branding/brand.json")
    return value


def files_manifest():
    return {p.relative_to(ROOT).as_posix(): sha(p.read_bytes()) for p in selected_files()}


def tree_digest(files):
    return sha("".join(f"{digest}  {name}\n" for name, digest in sorted(files.items())).encode())


def add_file(archive, name, data, executable=False):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name:
        raise ValueError("Unsafe source archive path")
    info = zipfile.ZipInfo(name, (2026, 11, 21, 0, 0, 0))
    info.compress_type = zipfile.ZIP_STORED if path.suffix.lower() in PRECOMPRESSED_SUFFIXES else zipfile.ZIP_DEFLATED
    info.external_attr = (0o100755 if executable else 0o100644) << 16
    archive.writestr(info, data)


def make(output, build_id, notices, core_source, go_bin=None):
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    before = files_manifest()
    brand = application_brand()
    inventory = {"schemaVersion": 1, "application": brand["id"], "version": brand["version"], "buildId": build_id,
                 "supportArchivePolicy": "exclude-private-payment-images; rebuild test packages with --nosign --without-support",
                 "applicationLicense": "GPL-3.0-or-later", "standaloneCoreLicense": "GPL-2.0-or-later",
                 "treeSHA256": tree_digest(before), "files": before, "dependencies": []}
    core_data = Path(core_source).read_bytes()
    if sha(core_data) != CORE_SOURCE_SHA256:
        raise ValueError("Verified core corresponding-source archive changed")
    dep_records = json.loads((Path(notices) / "dependency-notices.json").read_text())["records"]
    # The upstream module ZIPs are immutable pinned corresponding source, not
    # installed executables. They are read only; never execute their contents.
    module_cache = resolve_module_cache(go_bin)
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for source in selected_files():
            name = source.relative_to(ROOT).as_posix()
            data = source.read_bytes()
            # Vendored third-party files remain byte-exact. Our own source must
            # not expose a developer's private filesystem path.
            if source.suffix in (".py", ".sh", ".go", ".ts", ".tsx", ".json", ".md", ".txt", ".html", ".c", ".js", ".mjs") and "vendor" not in source.parts and PRIVATE.search(data):
                raise ValueError(f"Private local absolute path in source: {name}")
            if sha(data) != before[name]:
                raise ValueError(f"Source changed during ZIP creation: {name}")
            add_file(archive, "xiaoniubawang/" + name, data, bool(source.stat().st_mode & 0o111))
        for source in sorted(Path(notices).rglob("*")):
            if source.is_file():
                add_file(archive, "xiaoniubawang/distribution/" + source.relative_to(notices).as_posix(), source.read_bytes())
        core_name = "distribution/core-corresponding-source.tar.gz"
        if core_name in before:
            if before[core_name] != sha(core_data):
                raise ValueError("Public and bundled core source archives differ")
        else:
            add_file(archive, "xiaoniubawang/" + core_name, core_data)
        for record in dep_records:
            if record["kind"] != "go" or record["name"] == "Go-toolchain":
                continue
            escaped = "".join("!" + c.lower() if c.isupper() else c for c in record["name"])
            cached = module_cache / escaped / "@v" / (record["version"] + ".zip")
            data = cached.read_bytes()
            target = "dependencies/go/" + record["name"].replace("/", "_") + "@" + record["version"] + ".zip"
            add_file(archive, "xiaoniubawang/" + target, data)
            inventory["dependencies"].append({"module": record["name"], "version": record["version"], "file": target, "sha256": sha(data)})
        add_file(archive, "xiaoniubawang/SOURCE-MANIFEST.json", (json.dumps(inventory, ensure_ascii=False, indent=2) + "\n").encode())
    after = files_manifest()
    if before != after:
        raise ValueError("Source changed during snapshot; use a new build ID after freeze")
    result = {"file": output.name, "application": brand["id"], "version": brand["version"], "buildId": build_id,
              "supportArchivePolicy": inventory["supportArchivePolicy"], "sha256": sha(output.read_bytes()), "bytes": output.stat().st_size,
              "treeSHA256": inventory["treeSHA256"], "files": len(before), "goDependencySources": len(inventory["dependencies"]),
              "coreSourceSHA256": CORE_SOURCE_SHA256}
    (output.parent / "source-record.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--build-id", required=True)
    parser.add_argument("--notices", required=True, type=Path)
    default_core_source = ROOT / "build/20261121-core-01/emulator/xiaoniubawang-fceumm-corresponding-source.tar.gz"
    if not default_core_source.is_file():
        default_core_source = ROOT / "distribution/core-corresponding-source.tar.gz"
    parser.add_argument("--core-source", type=Path, default=default_core_source)
    parser.add_argument("--go", default=os.environ.get("GO_BINARY"))
    args = parser.parse_args()
    make(args.output, args.build_id, args.notices, args.core_source, args.go)
