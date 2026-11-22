#!/usr/bin/env python3
"""Collect full license texts from installed locked npm packages and linked Go modules."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
LICENSE_NAME = re.compile(r"^(licen[cs]e|copying|notice|copyright|patents)([._-].*)?$", re.I)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(data)


def text_files(directory):
    return [p for p in sorted(directory.iterdir()) if p.is_file() and LICENSE_NAME.match(p.name)]


def collect(output, go):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    records, warnings = [], []
    brand = json.loads((ROOT / "branding/brand.json").read_text())
    summary = [
        f"{brand['name']} {brand['version']} — licenses and dependency notices",
        "Application Go/React code: GPL-3.0-or-later; full text in licenses/application-GPL-3.0.txt.",
        "Dedicated FCEUmm frontend and core: GPL-2.0-or-later, preserved separately.",
        "GPL-2.0-or-later permits GPL-3.0-compatible combinations. Upstream notices remain unchanged.",
        "RetroArch and EmulatorJS were evaluated but are not linked or shipped as runtimes.",
        "modernc.org/sqlite v1.61.0 is BSD-3-Clause; SQLite itself is public domain.",
        "Inherited SQLite notices also identify MPL-2.0 graph-only components; preserve their complete text.",
        "npm build/test packages below are recorded separately from browser runtime dependencies.",
        "All collected license texts are verbatim from the installed dependencies used by this build.",
        "Uninstalled platform-specific optional packages in package-lock.json are not shipped.",
        "",
    ]

    def add(kind, name, version, files, role, metadata=None):
        ident = re.sub(r"[^A-Za-z0-9._-]", "_", f"{name}@{version}")
        collected = []
        for original, label in files:
            data = original.read_bytes()
            target = f"licenses/{kind}/{ident}/{label}.txt"
            write(output / target, data)
            collected.append({"file": target, "sha256": sha(data), "origin": label})
        item = {"kind": kind, "name": name, "version": version, "role": role, "licenses": collected}
        if metadata:
            item.update(metadata)
        records.append(item)
        summary.append(f"{kind}: {name}@{version} [{role}]")
        summary.extend("  " + f["file"] for f in collected)
        return item

    application = ROOT / "LICENSE"
    write(output / "licenses/application-GPL-3.0.txt", application.read_bytes())
    for directory in (ROOT / "emulator/licenses", ROOT / "third_party/games"):
        for path in sorted(directory.rglob("*")):
            if path.is_file() and (LICENSE_NAME.match(path.name) or path.name.lower() == "notices.md"):
                relative = path.relative_to(ROOT).as_posix()
                write(output / "licenses" / (relative + ".txt"), path.read_bytes())
    lock = json.loads((ROOT / "web/package-lock.json").read_text())
    absent = []
    for relative, locked in sorted(lock["packages"].items()):
        if not relative:
            continue
        directory = ROOT / "web" / relative
        if not directory.is_dir():
            if not locked.get("optional"):
                raise ValueError(f"Locked non-optional npm package is not installed: {relative}")
            absent.append({"path": relative, "version": locked["version"]})
            continue
        metadata = json.loads((directory / "package.json").read_text())
        if metadata["version"] != locked["version"]:
            raise ValueError(f"npm lock mismatch: {relative}")
        name = metadata["name"]
        files = [(p, p.name) for p in text_files(directory)]
        # Native build-tool packages inherit their parent's versioned license.
        if not files and name.startswith(("@esbuild/", "@rollup/")):
            parent = ROOT / "web/node_modules" / ("esbuild" if name.startswith("@esbuild/") else "rollup")
            parent_meta = json.loads((parent / "package.json").read_text())
            if parent_meta["version"] != metadata["version"]:
                raise ValueError("Native npm tool and parent versions differ")
            files = [(p, "parent-" + p.name) for p in text_files(parent)]
        if not files:
            if not locked.get("dev"):
                raise ValueError(f"Runtime npm license text missing: {name}")
            if name not in {"saxes", "stackback"}:
                raise ValueError(f"Unexpected build/test npm license text missing: {name}")
            # These two test-only published packages omit full LICENSE texts.
            files = [(directory / "package.json", "package-metadata")]
            warnings.append(f"Test-only {name}@{metadata['version']} publishes no full license text; exact package.json retained ({metadata.get('license', 'unspecified')}).")
        add("npm", name, metadata["version"], files,
            "build-or-test-only" if locked.get("dev") else "browser-runtime",
            {"declaredLicense": locked.get("license", metadata.get("license")), "lockPath": relative})
    base_env = dict(os.environ, GOPROXY="off", GOSUMDB="off", GOTOOLCHAIN="local", CGO_ENABLED="0", GOOS="linux")
    modules = {}
    for arch in ("amd64", "arm64"):
        result = subprocess.run([str(go), "-C", str(ROOT), "list", "-mod=readonly", "-deps", "-f",
                                 "{{if .Module}}{{.Module.Path}}|{{.Module.Version}}|{{.Module.Dir}}{{end}}",
                                 "./cmd/xiaoniubawang", "./packaging/fnos/helpers/procguard"],
                                env=dict(base_env, GOARCH=arch), text=True, capture_output=True, check=True)
        for line in result.stdout.splitlines():
            if not line:
                continue
            name, version, directory = line.split("|", 2)
            if name == "xiaoniubawang":
                continue
            old = modules.setdefault(name, {"version": version, "directory": directory, "architectures": []})
            if old["version"] != version:
                raise ValueError(f"Go module version differs by architecture: {name}")
            if arch not in old["architectures"]:
                old["architectures"].append(arch)
    for name, module in sorted(modules.items()):
        directory = Path(module["directory"])
        files = [(p, p.name) for p in text_files(directory)]
        if not files:
            raise ValueError(f"Linked Go module license missing: {name}")
        add("go", name, module["version"], files, "linked-runtime", {"architectures": module["architectures"]})
    goroot = Path(subprocess.check_output([str(go), "env", "GOROOT"], env=base_env, text=True).strip())
    version = subprocess.check_output([str(go), "version"], env=base_env, text=True).strip().split()[2]
    add("go", "Go-toolchain", version, [(p, p.name) for p in text_files(goroot)], "linked-standard-library-and-build-tool")
    inventory = {"schemaVersion": 1, "npmLockSHA256": sha((ROOT / "web/package-lock.json").read_bytes()),
                 "goModSHA256": sha((ROOT / "go.mod").read_bytes()), "goSumSHA256": sha((ROOT / "go.sum").read_bytes()),
                 "records": records, "optionalNotInstalled": absent, "warnings": warnings}
    write(output / "dependency-notices.json", (json.dumps(inventory, ensure_ascii=False, indent=2) + "\n").encode())
    summary.extend(["", "Collection boundaries:", *warnings])
    write(output / "LICENSES.txt", ("\n".join(summary) + "\n").encode())
    write(output / "licenses/INDEX.txt", ("\n".join(summary) + "\n").encode())
    print(json.dumps({"ok": True, "npmInstalled": sum(r["kind"] == "npm" for r in records),
                      "goLinkedModules": len(modules), "optionalNotInstalled": len(absent), "warnings": warnings}, ensure_ascii=False))
    return inventory


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--go", required=True, type=Path)
    args = parser.parse_args()
    collect(args.output, args.go)
