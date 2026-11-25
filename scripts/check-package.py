#!/usr/bin/env python3
"""Read-only exact fnOS stage/FPK checks, including ELF linkage and complete payload hashes."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import runpy
import struct
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
HOOKS = ("main", "install_init", "install_callback", "config_init", "config_callback", "upgrade_init", "upgrade_callback", "uninstall_init", "uninstall_callback")
MAX_FILE = 256 * 1024 * 1024


def sha(data):
    return hashlib.sha256(data).hexdigest()


def manifest(text, arch):
    result = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if not sep or key in result:
            raise ValueError("Malformed or duplicate manifest field")
        result[key.strip()] = value.strip()
    brand = json.loads((ROOT / "branding/brand.json").read_text())
    expected = {"appname": "xiaoniubawang", "version": brand["version"], "display_name": brand["name"], "platform": {"amd64": "x86", "arm64": "arm"}[arch],
                "desktop_uidir": "ui", "desktop_applaunchname": "xiaoniubawang.Application", "ctl_stop": "true", "checkport": "false", "disable_authorization_path": "false"}
    if brand.get("repositoryUrl"):
        for name in ("maintainer_url", "distributor_url"):
            expected[name] = brand["repositoryUrl"]
    for name, value in expected.items():
        if result.get(name) != value:
            raise ValueError(f"Wrong manifest {name}: {result.get(name)}")
    if "@PLATFORM@" in text or "service_port" in result or result.get("install_dep_apps"):
        raise ValueError("Unresolved platform or unexpected service/dependency")
    description = result.get("desc", "")
    if not re.search(r"<(?:div|p|h[1-6])(?:\s|>)", description, re.I) or not re.search(r"</(?:div|p|h[1-6])>", description, re.I):
        raise ValueError("Manifest description must contain actual rich HTML")
    if re.search(r"<\s*(?:script|iframe|object|embed)\b|\bon[a-z]+\s*=|javascript\s*:", description, re.I):
        raise ValueError("Unsafe active content in manifest rich HTML")
    return result


def elf(data, arch):
    if data[:6] != b"\x7fELF\x02\x01" or struct.unpack_from("<H", data, 18)[0] != {"amd64": 62, "arm64": 183}[arch]:
        raise ValueError("ELF must be little-endian 64-bit and match target architecture")
    phoff = struct.unpack_from("<Q", data, 32)[0]
    size, count = struct.unpack_from("<HH", data, 54)
    if size < 56 or phoff + size * count > len(data):
        raise ValueError("Invalid ELF program header table")
    needed, interpreter = [], False
    for index in range(count):
        start = phoff + size * index
        kind = struct.unpack_from("<I", data, start)[0]
        if kind == 3:
            interpreter = True
        if kind == 2:
            offset, length = struct.unpack_from("<QQ", data, start + 8)[0], struct.unpack_from("<Q", data, start + 32)[0]
            if offset + length > len(data) or length % 16:
                raise ValueError("Invalid ELF dynamic table")
            for pos in range(offset, offset + length, 16):
                tag, value = struct.unpack_from("<qQ", data, pos)
                if tag == 1:
                    needed.append(value)
    if interpreter or needed:
        raise ValueError("ELF is not static: PT_INTERP or DT_NEEDED found")
    return {"architecture": arch, "machine": {"amd64": 62, "arm64": 183}[arch], "PT_INTERP": False, "DT_NEEDED": [], "sha256": sha(data), "bytes": len(data)}


def inventory(archive):
    result, total = {}, 0
    for member in archive.getmembers():
        name = member.name
        while name.startswith("./"):
            name = name[2:]
        if name in ("", "."):
            continue
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or "\\" in name:
            raise ValueError(f"Unsafe package path: {name}")
        name = path.as_posix()
        if member.isdir():
            continue
        if not member.isfile() or name in result or member.size > MAX_FILE:
            raise ValueError(f"Unsafe, oversized or duplicate package member: {name}")
        if member.mode & 0o6022:
            raise ValueError(f"Package file has set-id or nonowner-write permissions: {name}")
        total += member.size
        if total > 512 * 1024 * 1024 or len(result) > 10000:
            raise ValueError("Package inventory exceeds bounds")
        result[name] = member
    return result


def read(archive, members, name):
    if name not in members:
        raise ValueError(f"Missing package file: {name}")
    stream = archive.extractfile(members[name])
    data = stream.read(MAX_FILE + 1)
    if len(data) != members[name].size:
        raise ValueError(f"Invalid package member length: {name}")
    return data


def check_source_zip(data):
    with zipfile.ZipFile(io.BytesIO(data)) as source:
        files = source.namelist()
        if len(files) != len(set(files)) or len(files) > 15000:
            raise ValueError("Duplicate or excessive source ZIP members")
        for name in files:
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or "\\" in name or any(x in path.parts for x in ("support", "support-assets", "donation", "node_modules", "logs", ".git")) or path.name in ("wechat-6uos.jpg", "alipay-6uos.jpg", "support-disabled.flag"):
                raise ValueError(f"Forbidden source ZIP path: {name}")
            if path.name == "AGENTS.md" and "vendor" not in path.parts:
                raise ValueError("Agent instructions leaked into source snapshot")
        if source.testzip() is not None:
            raise ValueError("Source ZIP CRC failure")
        record = json.loads(source.read("xiaoniubawang/SOURCE-MANIFEST.json"))
        source_brand = json.loads(source.read("xiaoniubawang/branding/brand.json"))
        if (record.get("application"), record.get("version")) != (source_brand["id"], source_brand["version"]):
            raise ValueError("Source application/version differs from its frozen branding")
        recorded_files = {"xiaoniubawang/" + name for name in record["files"]}
        allowed_files = recorded_files | {"xiaoniubawang/SOURCE-MANIFEST.json"} | {"xiaoniubawang/" + dep["file"] for dep in record["dependencies"]}
        if any(name not in allowed_files and not name.startswith("xiaoniubawang/distribution/") for name in files):
            raise ValueError("Unrecorded source ZIP file")
        for name, expected in record["files"].items():
            contents = source.read("xiaoniubawang/" + name)
            if "vendor" not in PurePosixPath(name).parts and re.search(rb"/(?:Users|home)/[A-Za-z0-9][^/\s\"'<>]+/", contents):
                raise ValueError(f"Private developer identity in source ZIP: {name}")
            if sha(source.read("xiaoniubawang/" + name)) != expected:
                raise ValueError(f"Source manifest differs: {name}")
        tree = sha("".join(f"{digest}  {name}\n" for name, digest in sorted(record["files"].items())).encode())
        if tree != record["treeSHA256"]:
            raise ValueError("Source tree digest mismatch")
        for dependency in record["dependencies"]:
            if sha(source.read("xiaoniubawang/" + dependency["file"])) != dependency["sha256"]:
                raise ValueError("Corresponding Go dependency source hash mismatch")
        if sha(source.read("xiaoniubawang/distribution/core-corresponding-source.tar.gz")) != "a5df940e9fff72a6daee22d898e2dda5a5a9305588e172eb37c53c07f5cd7821":
            raise ValueError("Verified full core source archive hash mismatch")
        for name in ("LICENSE", "go.mod", "go.sum", "web/package-lock.json", "emulator/frontend.c", "emulator/runtime.js", "scripts/build.py", "scripts/check-support.py", "scripts/support-assets-approved.json", "packaging/fnos/cmd/main"):
            if "xiaoniubawang/" + name not in files:
                raise ValueError(f"Incomplete corresponding source: {name}")
        return {"sha256": sha(data), "treeSHA256": record["treeSHA256"], "buildId": record["buildId"], "version": record["version"], "files": len(files)}


def check_stage(stage, arch, without_support=False, external_source=False, source_zip=None):
    stage = Path(stage)
    manifest((stage / "manifest").read_text(), arch)
    if json.loads((stage / "config/privilege").read_text()) != {"defaults": {"run-as": "package"}, "username": "xiaoniubawang", "groupname": "xiaoniubawang"}:
        raise ValueError("Long-running service must use the app package user")
    if json.loads((stage / "config/resource").read_text()) != {"api-scope": ["trim.file.userAccess", "trim.file.userAcl"]}:
        raise ValueError("Unexpected resource scopes")
    ui = json.loads((stage / "app/ui/config").read_text())[".url"]["xiaoniubawang.Application"]
    for key, value in {"type": "iframe", "gatewayPrefix": "/app/xiaoniubawang", "gatewaySocket": "xiaoniubawang.sock", "url": "/app/xiaoniubawang/", "allUsers": True}.items():
        if ui.get(key) != value:
            raise ValueError(f"Wrong desktop gateway {key}")
    runpy.run_path(str(ROOT / "scripts/check-assets.py"))["check"](stage)
    for name in HOOKS:
        path = stage / "cmd" / name
        if not path.is_file() or not os.access(path, os.X_OK) or path.read_bytes() != (ROOT / "packaging/fnos/cmd" / name).read_bytes():
            raise ValueError(f"Missing, changed or nonexecutable hook: {name}")
    support_module = runpy.run_path(str(ROOT / "scripts/check-support.py"))
    support = support_module["check_stage"](stage, without_support)
    lifecycle = (stage / "cmd/main").read_text()
    if re.search(r"--(?:dev[-_][A-Za-z0-9_-]*|listen)(?:[=\s\"']|$)", lifecycle):
        raise ValueError("Development identity or TCP-listen activation in lifecycle")
    if '--support-root "$SUPPORT_ROOT" --approve-support-assets' not in lifecycle or 'if [ "$SUPPORT_ENABLED" -eq 1 ]; then' not in lifecycle or '"$GUARD" verify-support "$APP_DIR"' not in lifecycle or '--without-support-assets' not in lifecycle:
        raise ValueError("Lifecycle must activate only native-verified exact support assets with nonblocking fallback")
    for name in ("install", "uninstall"):
        wizard = json.loads((stage / "wizard" / name).read_text())
        if re.search(r"--(?:dev[-_][A-Za-z0-9_-]*|listen)\b|localhost|127\.0\.0\.1|开发调试", json.dumps(wizard, ensure_ascii=False), re.I):
            raise ValueError(f"Debug identity/listener in {name} wizard")
    if "导出备份" not in (stage / "wizard/uninstall").read_text():
        raise ValueError("Uninstall wizard must require external backup")
    elves = {}
    for name in ("xiaoniubawang", "procguard"):
        path = stage / "app/server" / name
        if not os.access(path, os.X_OK):
            raise ValueError(f"Nonexecutable native file: {name}")
        elves[name] = elf(path.read_bytes(), arch)
    web = stage / "app/web/dist"
    provenance = json.loads((ROOT / "emulator/provenance.json").read_text())
    for name in ("fceumm.js", "fceumm-core.mjs", "fceumm-core.wasm"):
        if sha((web / "cores" / name).read_bytes()) != provenance["outputs"][name]["sha256"]:
            raise ValueError(f"Real core output changed: {name}")
    if (web / "cores/fceumm-core.wasm").read_bytes()[:8] != b"\x00asm\x01\x00\x00\x00":
        raise ValueError("Invalid WASM header")
    catalog = json.loads((web / "games/catalog.json").read_text())
    # Every catalog entry must have actual core evidence and exact ROM bytes.
    verified = {rom["id"]: rom for rom in provenance["verification"]["catalogROMs"]}
    games = catalog["games"]
    if not 5 <= len(games) <= 8 or len({game["id"] for game in games}) != len(games) or {game["id"] for game in games} != set(verified):
        raise ValueError("Bundled catalog and verified ROM identities differ")
    for game in games:
        rom = verified[game["id"]]
        if game["sha256"] != rom["romSHA256"] or not rom["deterministicState"]:
            raise ValueError(f"Unverified catalog ROM: {game['id']}")
        filename = game["filename"]
        if PurePosixPath(filename).name != filename or not filename.endswith(".nes") or sha((web / "games" / filename).read_bytes()) != rom["romSHA256"]:
            raise ValueError(f"Verified catalog ROM changed: {game['id']}")
    for path in (stage / "app").rglob("*"):
        if path.is_symlink():
            raise ValueError("No runtime payload symlinks allowed")
        relative = path.relative_to(stage / "app")
        allowed_support = {"support", *("support/" + name for name in support_module["APPROVED_FILES"])} if support["enabled"] else {support_module["DISABLED_NAME"]}
        if ("support" in relative.parts or path.name in support_module["APPROVED_FILES"] or path.name == support_module["DISABLED_NAME"]) and relative.as_posix() not in allowed_support:
            raise ValueError(f"Unapproved support payload path: {relative}")
        empty_legacy_directory = relative.as_posix() in {"ui/donation", "web/dist/donation"} and path.is_dir() and not any(path.iterdir())
        if any(part in relative.parts for part in ("node_modules", "logs", ".git", "xiaoniubawang-data")) or ("donation" in relative.parts and not empty_legacy_directory) or "support-assets" in relative.parts:
            raise ValueError(f"Private/unapproved payload path: {relative}")
        if path.is_file() and path.suffix in (".js", ".mjs", ".html", ".json", ".txt", ".flag") and re.search(rb"/(?:Users|home)/[A-Za-z0-9][^/\s\"'<>]+/", path.read_bytes()):
            raise ValueError(f"Private developer path in runtime asset: {relative}")
    if not (web / "LICENSES.txt").is_file() or not (web / "licenses/application-GPL-3.0.txt").is_file():
        raise ValueError("Missing full application/dependency licenses")
    if external_source:
        offer_path = web / "source/SOURCE-OFFER.json"
        if not offer_path.is_file() or (web / "source/source.zip").exists():
            raise ValueError("External-source stage must contain source/SOURCE-OFFER.json without embedded source.zip")
        if not source_zip or not Path(source_zip).is_file():
            raise ValueError("External-source inspection requires --source-zip pointing to the companion archive")
        offer = json.loads(offer_path.read_text(encoding="utf-8"))
        source = check_source_zip(Path(source_zip).read_bytes())
        if offer.get("sha256") != source["sha256"] or offer.get("treeSHA256") != source["treeSHA256"] or offer.get("version") != source["version"] or offer.get("buildId") != source["buildId"]:
            raise ValueError("External source offer does not match verified companion source archive")
    else:
        source = check_source_zip((web / "source/source.zip").read_bytes())
    if source["version"] != json.loads((ROOT / "branding/brand.json").read_text())["version"]:
        raise ValueError("Staged source version differs from application branding")
    return {"elf": elves, "source": source, "support": support, "catalogLoaded": bool(catalog), "icons": "approved exact RGBA 256/512", "lifecycle": "complete executable hooks"}


def check_support_archive(archive, prefix, enabled):
    support_module = runpy.run_path(str(ROOT / "scripts/check-support.py"))
    approved = support_module["APPROVED_FILES"]
    observed = set()
    for member in archive.getmembers():
        normalized = PurePosixPath(member.name).as_posix()
        relative = normalized.removeprefix(prefix)
        if "support" not in PurePosixPath(relative).parts:
            continue
        allowed = {"support", *("support/" + name for name in approved)} if enabled else set()
        if relative not in allowed:
            raise ValueError(f"Unapproved support archive path: {normalized}")
        if member.isdir():
            if relative != "support" or member.mode not in (0o700, 0o755):
                raise ValueError(f"Unsafe or extra support archive directory: {normalized}")
            continue
        name = PurePosixPath(relative).name
        if not member.isfile() or name not in approved or name in observed or member.mode not in (0o600, 0o644):
            raise ValueError(f"Unsafe support archive member: {normalized}")
        if member.size != approved[name]["bytes"] or sha(archive.extractfile(member).read(MAX_FILE + 1)) != approved[name]["sha256"]:
            raise ValueError(f"Approved support archive bytes changed: {name}")
        observed.add(name)
    if observed != (set(approved) if enabled else set()):
        raise ValueError("Support archive must contain exactly the two approved originals unless explicitly disabled")


SIGNATURE = runpy.run_path(str(ROOT / "scripts/release-signature.py"))
SIGNED_METADATA_FILES = SIGNATURE["METADATA_FILES"]


def release_signature(package, stage, expected_certificate=None):
    """Opt-in signed-output gate, not an asserted application-store requirement.

    Require an independently selected existing public certificate and exact
    signed outer512 bytes. No default credential lookup or signed mutation.
    """
    with tarfile.open(package, "r:*") as outer:
        members = inventory(outer)
        if "ICON_512.PNG" not in members:
            raise ValueError("RELEASE_ICON512_MISSING: signed official output must include the exact detail icon; signed supplementation is forbidden")
        if read(outer, members, "ICON_512.PNG") != (Path(stage) / "ICON_512.PNG").read_bytes():
            raise ValueError("RELEASE_ICON512_CHANGED: signed detail icon differs from approved stage")
        verified = SIGNATURE["verify_signature_metadata"](outer, members, read, expected_certificate)
        verified["detailIcon512"] = "exact signed outer bytes match approved stage"
        return verified


def check_package(package, stage, arch, without_support=False, release=False, expected_certificate=None, publish=False, external_source=False, source_zip=None):
    if publish and (release or without_support):
        raise ValueError("Ordinary publication candidates require approved support and cannot also claim signing")
    if release and without_support:
        raise ValueError("Release requires both approved support originals")
    signing = release_signature(package, stage, expected_certificate) if release else None
    stage, package = Path(stage), Path(package)
    report = check_stage(stage, arch, without_support, external_source, source_zip)
    with tarfile.open(package, "r:*") as outer:
        members = inventory(outer)
        values = manifest(read(outer, members, "manifest").decode(), arch)
        if {k: v for k, v in values.items() if k != "checksum"} != manifest((stage / "manifest").read_text(), arch):
            raise ValueError("FPK manifest differs from staged source")
        staged_outer = {p.relative_to(stage).as_posix(): p for p in stage.rglob("*") if p.is_file() and p.relative_to(stage).parts[0] not in ("app",)}
        metadata = SIGNED_METADATA_FILES if release else frozenset()
        if not release and any(name in members for name in SIGNED_METADATA_FILES):
            raise ValueError("Signed metadata requires opt-in --release verification with an expected public certificate")
        if set(members) != set(staged_outer) | {"app.tgz"} | metadata:
            raise ValueError(f"Outer FPK inventory mismatch: extra={set(members) - set(staged_outer) - {'app.tgz'} - metadata}, missing={set(staged_outer) - set(members)}")
        for name, path in staged_outer.items():
            if name != "manifest" and read(outer, members, name) != path.read_bytes():
                raise ValueError(f"Outer FPK bytes differ: {name}")
            if name.startswith("cmd/") and members[name].mode & 0o111 == 0:
                raise ValueError(f"FPK hook is not executable: {name}")
        payload = read(outer, members, "app.tgz")
        checksum = values.get("checksum")
        if checksum and checksum not in (hashlib.md5(payload).hexdigest(), sha(payload)):
            raise ValueError("Manifest app.tgz checksum mismatch")
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:*") as inner:
            files = inventory(inner)
            prefix = "app/" if "app/server/xiaoniubawang" in files else ""
            check_support_archive(inner, prefix, report["support"]["enabled"])
            staged = {prefix + p.relative_to(stage / "app").as_posix(): p for p in (stage / "app").rglob("*") if p.is_file()}
            # fnpack v1.3.3 also duplicates these exact outer configuration
            # files into app.tgz. Verify both copies rather than accepting
            # arbitrary additional payload files.
            staged.update({prefix + "config/" + name: stage / "config" / name for name in ("privilege", "resource")})
            if set(files) != set(staged):
                raise ValueError("Complete app payload inventory differs from stage")
            hashes = {}
            for name, path in staged.items():
                actual = read(inner, files, name)
                if actual != path.read_bytes():
                    raise ValueError(f"Payload bytes differ: {name}")
                hashes[name] = sha(actual)
                if path.stat().st_mode & 0o111 and files[name].mode & 0o111 == 0:
                    raise ValueError(f"Payload executable bit lost: {name}")
                relative = path.relative_to(stage / "app") if path.is_relative_to(stage / "app") else None
                if relative and (relative.parts[0] == "support" or relative.as_posix() == "support-disabled.flag"):
                    if files[name].mode not in (0o600, 0o644):
                        raise ValueError(f"Support payload must preserve regular 0600/0644 permissions: {name}")
    report.update({"ok": True, "package": str(package), "sha256": sha(package.read_bytes()), "architecture": arch,
                   "payloadFiles": len(hashes), "payloadSHA256": hashes, "outerFiles": len(members), "manifestChecksumVerified": bool(checksum),
                   "signing": "official-fnpack-signed" if signing else "unsigned-official-package" if publish else "unsigned-local-debug", "signatureVerification": signing,
                   "releaseReady": False, "mode": "opt-in-signed-release" if release else "ordinary-publication-candidate" if publish else "unsigned-local-test",
                   "storeSigningRequirement": "not established; verify actual publishing-channel requirements", "deviceValidation": "not performed"})
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", required=True, type=Path)
    parser.add_argument("--arch", required=True, choices=("amd64", "arm64"))
    parser.add_argument("--package", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--without-support", action="store_true", help="explicitly allow only a support-disabled source-only build, not a release with missing originals")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--release", action="store_true", help="opt-in read-only signed-output gate; not a claim that store submission requires signing")
    mode.add_argument("--publish", action="store_true", help="ordinary unsigned official package inspection, not store approval")
    mode.add_argument("--nosign", action="store_true", help="unsigned local-test inspection, never verified signed output")
    parser.add_argument("--expected-certificate", type=Path, help="independently selected existing developer public certificate for opt-in --release; no default lookup")
    parser.add_argument("--external-source", action="store_true", help="validate slim external-source staging using companion --source-zip")
    parser.add_argument("--source-zip", type=Path, help="companion corresponding-source ZIP for --external-source validation")
    args = parser.parse_args()
    if (args.release or args.publish) and args.without_support:
        parser.error("Publication candidates cannot omit either approved support original")
    if args.expected_certificate and not args.release:
        parser.error("--expected-certificate is only used by opt-in --release")
    if args.release and not args.package:
        parser.error("--release requires the actual signed package")
    if args.external_source and not args.source_zip:
        parser.error("--external-source requires --source-zip")
    result = check_package(args.package, args.stage, args.arch, args.without_support, args.release, args.expected_certificate, args.publish, args.external_source, args.source_zip) if args.package else check_stage(args.stage, args.arch, args.without_support, args.external_source, args.source_zip)
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        with args.report.open("x") as stream:
            stream.write(text)
    print(text)
