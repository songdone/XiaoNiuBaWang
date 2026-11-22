#!/usr/bin/env python3
"""Build isolated Linux amd64/arm64 fnOS test packages or fail-closed signed releases."""
from __future__ import annotations

import argparse
from datetime import datetime
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import subprocess
import sys
import tarfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
PINNED_FNPACK = "2f933c55ec1bdd1f18aa175ce916cb571ae021f18a6d137edfdd7e8333877648"
PINNED_PUBLISH_FNPACK = "d40cb00896cb2a5d211357d255750ed0cbe7f2d141df671c2b717afb4e74bf77"


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def save(path, value):
    with Path(path).open("x") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def resolve_go(explicit):
    if explicit:
        path = Path(explicit).expanduser().resolve()
        if path.is_file():
            return path
        raise ValueError("Configured Go toolchain does not exist")
    local = list((Path.home() / "go/pkg/mod/golang.org").glob("toolchain@v0.0.1-go1.26.*/bin/go"))
    if local:
        return max(local, key=lambda p: int(re.search(r"go1\.26\.(\d+)", str(p)).group(1)))
    located = shutil.which("go")
    if not located:
        raise ValueError("Go 1.26 toolchain required; set --go")
    return Path(located).resolve()


def run(command, build, name, env=None, cwd=ROOT):
    print(f"[{name}] running", flush=True)
    logfile = build / "logs" / (name + ".log")
    with logfile.open("x") as stream:
        result = subprocess.run([str(x) for x in command], cwd=str(cwd), env=env,
                                stdout=stream, stderr=subprocess.STDOUT)
    with (build / "package-build.log").open("a") as combined:
        combined.write(f"\n===== {name} =====\n")
        combined.write(logfile.read_text(errors="replace"))
    if result.returncode:
        raise ValueError(f"{name} failed with exit {result.returncode}; see {logfile}")
    return logfile.read_text(errors="replace")


def source_copy(destination, source_module):
    for source in source_module["selected_files"]():
        target = destination / source.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def official_gate(stage, package, arch, build, name, checker):
    command = [sys.executable, "-I", "-B", checker, stage]
    if package:
        command += ["--package", package]
    command += ["--elf", "server/xiaoniubawang", "--elf", "server/procguard", "--expect-arch", arch, "--require-static"]
    run(command, build, name)


def supplement_unsigned(raw, stage, target, package_module, publish=False):
    raw_hash = sha(raw)
    with tarfile.open(raw, "r:*") as archive:
        files = package_module["inventory"](archive)
        observed = sorted(files)
        # Only the exact recognized unsigned output may be supplemented/copied.
        # Reject signed metadata even when the official tool already includes512.
        allowed = {"manifest", "ICON.PNG", "ICON_256.PNG", "app.tgz"}
        allowed.update(p.relative_to(stage).as_posix() for folder in ("cmd", "config", "wizard") for p in (stage / folder).rglob("*") if p.is_file())
        expected = allowed | ({"ICON_512.PNG"} if "ICON_512.PNG" in files else set())
        if set(files) != expected:
            raise ValueError("Unknown or signed raw FPK shape; refusing detail-icon supplementation")
        if "ICON_512.PNG" in files:
            if package_module["read"](archive, files, "ICON_512.PNG") != (stage / "ICON_512.PNG").read_bytes():
                raise ValueError("Unsigned official detail icon differs from exact approved stage")
            shutil.copy2(raw, target)
            return {"rawSHA256": raw_hash, "rawMembers": observed, "supplemented": False}
        with target.open("xb") as output:
            with gzip.GzipFile(fileobj=output, mode="wb", filename="", mtime=0) as compressed:
                with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as candidate:
                    for member in archive.getmembers():
                        source = archive.extractfile(member) if member.isfile() else None
                        candidate.addfile(member, source)
                    icon = (stage / "ICON_512.PNG").read_bytes()
                    member = tarfile.TarInfo("ICON_512.PNG")
                    member.mode, member.size, member.mtime = 0o644, len(icon), 0
                    candidate.addfile(member, io.BytesIO(icon))
    if sha(raw) != raw_hash:
        raise ValueError("Raw official fnpack output was changed")
    return {"rawSHA256": raw_hash, "rawMembers": observed, "supplemented": True,
            "reason": "Official tool omits outer 512 detail icon; unsigned copy adds exact staged ICON_512.PNG before final package inspection",
            "signing": "unsigned-official-package" if publish else "unsigned-local-debug; never submit as signed release"}


def signing_preflight(status):
    """Inspect official public status, never locate/read/import private credentials."""
    codes = []
    if re.search(r"Key:\s*missing", status, re.I):
        codes.append("RELEASE_KEY_MISSING")
    if re.search(r"Cert:\s*missing", status, re.I):
        codes.append("RELEASE_CERTIFICATE_MISSING")
    if "not configured" in status.lower() and not codes:
        codes.append("RELEASE_DEFAULT_CERTIFICATE_NOT_CONFIGURED")
    if not codes and not re.search(r"(?:fingerprint|sha-?256)", status, re.I):
        codes.append("RELEASE_CERTIFICATE_STATUS_UNRECOGNIZED")
    if codes:
        raise ValueError(",".join(codes) + ": selected fnpack default signing context is not ready; this does not describe other tools or existing explicit certificate paths")
    return {"status": "selected-official-tool-default-configured", "privateKeysReadByAssistant": False}


def fnpack_command(fnpack, stage, release, key=None, cert=None, publish=False):
    command = [fnpack, "build", "--directory", stage]
    if not release and not publish:
        command.append("--nosign")
    elif key is not None and cert is not None:
        command += ["--key", key, "--cert", cert]
    return command


def signed_candidate(raw, stage, target, package_module, expected_certificate=None):
    # Never rewrite any signed archive. Validate the original, then copy exact
    # bytes only after a read-only release gate has accepted the official output.
    raw_hash = sha(raw)
    package_module["release_signature"](raw, stage, expected_certificate)
    shutil.copy2(raw, target)
    if sha(raw) != raw_hash or sha(target) != raw_hash:
        raise ValueError("Signed official fnpack bytes changed")
    return {"rawSHA256": raw_hash, "supplemented": False, "signing": "official-fnpack-signed"}


DELIVERY_OWNER = "xiaoniubawang-release-delivery/v1"
DELIVERY_NAMES = {"amd64": "小牛霸王学习机-x86_64.fpk", "arm64": "小牛霸王学习机-ARM64.fpk"}
DELIVERY_SOURCE = "小牛霸王学习机-源码.zip"
DELIVERY_LICENSE = "开源许可.txt"
DELIVERY_MANIFEST = "交付清单.json"
DELIVERY_INSTRUCTIONS = "安装说明.txt"
# One explicitly inspected pre-manifest delivery may be archived unchanged.
# Pin every byte, including its checksum list and instructions, not just names.
LEGACY_DELIVERY_SHA256 = {
    "小牛霸王学习机-ARM64.fpk": "d2e1cb85b14082a0413b0506a614173a58450de1d257a3623585182f61568015",
    "小牛霸王学习机-x86_64.fpk": "b8685d48b5175d21ec7b0cb872b5ef53fbbfc9faf2e29ea5cd8978e319cc1ef9",
    "小牛霸王学习机-源码.zip": "03f0ed8d611451b34c46a324341251814e5078977647d23aee3c0563b611192a",
    "LICENSES.txt": "0ce3b373b32dd6cd4fd1921f5a57dee51a10b7d944e6f6743ac73836a838d0ba",
    "SHA256SUMS": "57493831d157177b59151271fb935aad318fc933b8bce60dd7ba0f4846a780c8",
    "安装说明.txt": "bf2b573559d333cb6ab3775bfc715c3f8444b9440fba2f285a35b1347c968af7",
}


def delivery_path(path, *, directory=False):
    """Require a real, project-confined path, without following any symlinks."""
    path = Path(path).absolute()
    root = ROOT.resolve()
    if ".." in path.parts or not path.is_relative_to(root) or path == root:
        raise ValueError("Delivery paths must stay inside the project")
    current = root
    for part in path.relative_to(root).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Delivery path contains a symlink; preserving it")
    if directory and not path.is_dir():
        raise ValueError("Delivery directory must be a real directory")
    if not directory and not path.is_file():
        raise ValueError("Delivery input must be a regular file")
    return path


def delivery_snapshot(directory):
    directory = delivery_path(directory, directory=True)
    result = {}
    for path in sorted(directory.iterdir()):
        delivery_path(path)
        result[path.name] = sha(path)
    return result


def delivery_json(value):
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def delivery_checksums(records):
    return "".join(f"{item['sha256']}  {item['filename']}\n" for item in sorted(records, key=lambda item: item["filename"]))


def inspect_delivery(directory, *, allow_legacy=False):
    """Inspect before any move; new deliveries require their archive-side anchor."""
    observed = delivery_snapshot(directory)
    if allow_legacy and observed == LEGACY_DELIVERY_SHA256:
        return observed
    names = set(DELIVERY_NAMES.values()) | {DELIVERY_SOURCE, DELIVERY_LICENSE,
            DELIVERY_MANIFEST, DELIVERY_INSTRUCTIONS, "SHA256SUMS"}
    if set(observed) != names:
        raise ValueError("Unexpected delivery files; preserving existing contents")
    manifest_path = Path(directory) / DELIVERY_MANIFEST
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("owner") != DELIVERY_OWNER or manifest.get("schemaVersion") != 1:
        raise ValueError("Unrecognized delivery ownership; preserving it")
    build_path = manifest.get("buildPath", "")
    if not isinstance(build_path, str) or not build_path or Path(build_path).is_absolute() or ".." in Path(build_path).parts:
        raise ValueError("Invalid delivery archive path")
    build = delivery_path(ROOT / build_path, directory=True)
    if manifest.get("buildId") != build.name:
        raise ValueError("Delivery build identity differs from its archive")
    anchor_path = delivery_path(build / "delivery-record.json")
    anchor = json.loads(anchor_path.read_text(encoding="utf-8"))
    if anchor.get("owner") != DELIVERY_OWNER or anchor.get("buildPath") != build_path or anchor.get("files") != observed:
        raise ValueError("Delivery checksum differs from owned archive record; preserving it")
    records = manifest.get("files", [])
    expected_names = names - {DELIVERY_MANIFEST, "SHA256SUMS"}
    if not isinstance(records, list) or len(records) != len(expected_names) or {item.get("filename") for item in records} != expected_names:
        raise ValueError("Delivery manifest inventory differs")
    for item in records:
        if observed[item["filename"]] != item.get("sha256"):
            raise ValueError("Delivery manifest checksum differs")
    checksum_records = records + [{"filename": DELIVERY_MANIFEST, "sha256": observed[DELIVERY_MANIFEST]}]
    if (Path(directory) / "SHA256SUMS").read_text(encoding="utf-8") != delivery_checksums(checksum_records):
        raise ValueError("Delivery checksum list differs")
    if manifest.get("releaseReady") is not False or manifest.get("deviceValidation") != "not performed" or manifest.get("publicSubmission") != "not performed":
        raise ValueError("Delivery overstates release or device acceptance")
    return observed


def deliver(build, packages, version):
    """Stage exact verified bytes; never publish or operate on the latest folder."""
    build = delivery_path(build, directory=True)
    if not isinstance(version, str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?", version):
        raise ValueError("Invalid delivery version")
    if len(packages) != 2 or {item.get("architecture") for item in packages} != set(DELIVERY_NAMES):
        raise ValueError("Delivery requires exactly both verified architectures")
    source = delivery_path(build / "source/source.zip")
    licenses = delivery_path(build / "notices/LICENSES.txt")
    source_hash = sha(source)
    signing = {}
    inputs = []
    for item in sorted(packages, key=lambda item: item["architecture"]):
        package = delivery_path(item["package"])
        if not package.is_relative_to(build) or item.get("ok") is not True or sha(package) != item.get("sha256"):
            raise ValueError("Delivery package is not an exact verified current-build candidate")
        proof = item.get("source", {})
        if proof.get("sha256") != source_hash or proof.get("version") != version or proof.get("buildId") != build.name:
            raise ValueError("Delivery source differs from verified package source/version/build")
        if item.get("signing") not in ("unsigned-local-debug", "unsigned-official-package", "official-fnpack-signed"):
            raise ValueError("Delivery package signing scope is unrecognized")
        signing[item["architecture"]] = item["signing"]
        inputs.append((package, DELIVERY_NAMES[item["architecture"]], item["sha256"], item["architecture"]))
    if len(set(signing.values())) != 1:
        raise ValueError("Mixed signing scopes cannot form one delivery")
    inputs += [(source, DELIVERY_SOURCE, source_hash, None), (licenses, DELIVERY_LICENSE, sha(licenses), None)]
    delivery = build / "delivery"
    # Exclusive creation protects an existing staging directory and its contents.
    delivery.mkdir()
    records = []
    for source, filename, expected, architecture in inputs:
        target = delivery / filename
        with source.open("rb") as incoming, target.open("xb") as outgoing:
            shutil.copyfileobj(incoming, outgoing)
        if sha(source) != expected or sha(target) != expected:
            raise ValueError("Delivery copy checksum differs")
        record = {"filename": filename, "sha256": expected}
        if architecture:
            record["architecture"] = architecture
        records.append(record)
    signed = all(value == "official-fnpack-signed" for value in signing.values())
    instructions = (
        "小牛霸王学习机｜最新安装包\n\n"
        f"版本：{version}\n构建：{build.name}\n\n"
        "ARM64 使用 小牛霸王学习机-ARM64.fpk；Intel / AMD x86_64 使用 小牛霸王学习机-x86_64.fpk。\n"
        "源码与两份安装包的验包记录一致，开源许可.txt 提供许可说明；SHA256SUMS 校验全部交付文件（不含校验表自身）。\n\n"
        + ("签名状态：官方 fnpack 签名验包通过，仅代表安装包签名，不代表设备验收或上架批准。\n" if signed else
           "签名状态：未签名；由既有官方普通打包流程生成，不冒充已签名。\n" if all(value == "unsigned-official-package" for value in signing.values()) else
           "签名状态：未签名本地测试包，不是已签名上架成品。\n")
        + "平台是否要求签名须按实际提交要求确认；本脚本不把未签名状态等同于平台禁止提交。\n"
        + "设备验收：未执行；本构建脚本不证明 NAS 安装、保数据升级、浏览器或实体输入设备验收通过。\n"
        "上架提交：未执行；releaseReady=false，须另行确认平台实际提交要求、真实设备验收和发布批准。\n\n"
        "更新前先导出完整备份。设备可能拒绝同版本更新，不要卸载重装绕过；使用平台允许的保数据更新方式。\n"
        "只从这个真实中文文件夹取包；开发构建与上一版交付保存在开发存档。\n"
    )
    with (delivery / DELIVERY_INSTRUCTIONS).open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(instructions)
    metadata_records = records + [{"filename": DELIVERY_INSTRUCTIONS, "sha256": sha(delivery / DELIVERY_INSTRUCTIONS)}]
    manifest = {"owner": DELIVERY_OWNER, "schemaVersion": 1, "application": "xiaoniubawang",
                "buildId": build.name, "buildPath": build.relative_to(ROOT.resolve()).as_posix(), "version": version,
                "packageReady": True, "signed": signed, "signing": signing, "releaseReady": False,
                "deviceValidation": "not performed", "publicSubmission": "not performed",
                "files": sorted(metadata_records, key=lambda item: item["filename"])}
    with (delivery / DELIVERY_MANIFEST).open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(delivery_json(manifest))
    checksum_records = metadata_records + [{"filename": DELIVERY_MANIFEST, "sha256": sha(delivery / DELIVERY_MANIFEST)}]
    with (delivery / "SHA256SUMS").open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(delivery_checksums(checksum_records))
    anchor = {"owner": DELIVERY_OWNER, "buildPath": manifest["buildPath"], "files": delivery_snapshot(delivery)}
    with (build / "delivery-record.json").open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(delivery_json(anchor))
    inspect_delivery(delivery)
    return records


def publish_pointer(build):
    """Publish a real Chinese directory; keep a correct hidden dist alias intact.

    Keep build/delivery as the immutable staging evidence. Move the previous
    real folder into this build, then atomically rename an inspected exact copy.
    Failed moves restore the old folder; no old files are ever deleted.
    """
    build = delivery_path(build, directory=True)
    delivery = build / "delivery"
    staged = inspect_delivery(delivery)
    latest = ROOT / "最新安装包"
    link = ROOT / "dist"
    if link.is_symlink():
        if os.readlink(link) != "最新安装包":
            raise ValueError("Existing dist is not the approved Chinese alias; preserving it")
    elif link.exists():
        raise ValueError("Existing dist is not an owned symlink; preserving it")
    previous = inspect_delivery(latest, allow_legacy=True) if latest.exists() or latest.is_symlink() else None
    archive = build / "previous-delivery"
    if archive.exists() or archive.is_symlink():
        raise ValueError("Previous-delivery archive already exists; preserving it")
    temporary = build / (".delivery-publish-" + uuid.uuid4().hex)
    temporary.mkdir()
    for filename, expected in staged.items():
        source = delivery_path(delivery / filename)
        with source.open("rb") as incoming, (temporary / filename).open("xb") as outgoing:
            shutil.copyfileobj(incoming, outgoing)
        if sha(source) != expected or sha(temporary / filename) != expected:
            raise ValueError("Publication copy checksum differs; staging retained")
    if inspect_delivery(temporary) != staged:
        raise ValueError("Publication staging changed")
    # Reinspect after preparing the copy, before touching the live directory.
    if previous is not None:
        if inspect_delivery(latest, allow_legacy=True) != previous:
            raise ValueError("Existing delivery changed during publication; preserving it")
    elif latest.exists() or latest.is_symlink():
        raise ValueError("Latest directory appeared during publication; preserving it")
    if (link.is_symlink() and os.readlink(link) != "最新安装包") or (not link.is_symlink() and link.exists()):
        raise ValueError("dist changed during publication; preserving it")
    if archive.exists() or archive.is_symlink():
        raise ValueError("Previous-delivery archive appeared during publication; preserving it")
    old_moved = False
    new_moved = False
    try:
        if previous is not None:
            os.rename(latest, archive)
            old_moved = True
        os.rename(temporary, latest)
        new_moved = True
        if inspect_delivery(latest) != staged:
            raise ValueError("Published directory checksum differs")
    except Exception:
        # Rename rather than delete the failed candidate. Never overwrite a
        # concurrently appearing or uninspected folder while rolling back.
        if new_moved:
            os.rename(latest, temporary)
        if old_moved:
            if latest.exists() or latest.is_symlink():
                raise ValueError("Rollback blocked by unexpected latest path; previous contents preserved in archive")
            os.rename(archive, latest)
        raise
    return {"path": str(link), "previousTarget": str(archive) if previous is not None else None,
            "target": str(latest), "realDirectory": True, "staging": str(delivery),
            "distAliasPreserved": link.is_symlink(), "sha256": staged}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-id", default=datetime.now().strftime("%Y%m%d-fpk-%H%M%S") + "-" + uuid.uuid4().hex[:4])
    parser.add_argument("--go", default=os.environ.get("GO_BINARY"))
    parser.add_argument("--fnpack", type=Path, help="verified official tool; defaults to existing 1.2.3 for --publish or pinned 1.3.3 for signing/testing")
    parser.add_argument("--checker", type=Path, default=Path.home() / ".zcode/skills/fnos-app-engineering/scripts/check-fnos-project.py")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--nosign", action="store_true", help="unsigned local testing only; never a signed release")
    mode.add_argument("--publish", action="store_true", help="existing official v1.2.3 ordinary packaging flow; unsigned, not publication approval")
    mode.add_argument("--release", action="store_true", help="official fnpack signing, both approved support originals and unmodified exact 512-icon output required")
    parser.add_argument("--key", type=Path, help="existing developer private key path passed only to official fnpack; never read/imported by this script")
    parser.add_argument("--cert", type=Path, help="existing matching developer certificate path; requires --release and --key")
    parser.add_argument("--skip-web", action="store_true", help="reuse existing verified web/dist; its full file hashes are recorded")
    parser.add_argument("--no-deliver", action="store_true", help="staging build: do not replace the real 最新安装包 directory")
    parser.add_argument("--output-root", type=Path, default=ROOT / "开发存档/上架发布/构建", help="internal project archive folder for isolated build outputs")
    parser.add_argument("--without-support", action="store_true", help="explicit source-only build: exclude private payment images and disable support launch flags; default release requires approved originals")
    args = parser.parse_args()
    if bool(args.key) != bool(args.cert) or ((args.key or args.cert) and not args.release):
        parser.error("--key and --cert must be supplied together, only with --release")
    if (args.release or args.publish) and args.without_support:
        parser.error("Publication candidates require both approved support originals; --without-support is test-only")
    if not re.fullmatch(r"[0-9]{8}-(?:fpk|release-toolchain)-[A-Za-z0-9._-]+", args.build_id):
        parser.error("Build ID must start with an eight-digit date and -fpk- or -release-toolchain- followed by safe filename characters")
    source_module = runpy.run_path(str(ROOT / "scripts/make-source.py"))
    version = source_module["application_brand"]()["version"]
    output_root = args.output_root.resolve()
    if not output_root.is_relative_to(ROOT) or output_root == ROOT:
        parser.error("Build outputs must stay inside a project archive folder")
    build = output_root / args.build_id
    build.mkdir(parents=True, exist_ok=False)
    (build / "logs").mkdir()
    report = {"ok": False, "buildId": args.build_id, "version": version, "architectures": ["amd64", "arm64"],
              "mode": "ordinary-publication-candidate" if args.publish else "signed-release" if args.release else "unsigned-local-test", "packageReady": False, "signed": False, "releaseReady": False,
              "signing": "unsigned-official-package" if args.publish else "required-official-fnpack" if args.release else "unsigned-local-debug", "publicSubmission": "not performed", "deviceValidation": "not performed", "packages": [], "webBuildReused": args.skip_web,
              "withoutSupport": args.without_support}
    try:
        support_module = runpy.run_path(str(ROOT / "scripts/check-support.py"))
        support_module["approval"]()
        if args.without_support:
            report["support"] = {"enabled": False, "mode": "explicit-without-support", "privateImagesExcludedFromSource": True}
        else:
            run([sys.executable, "-I", "-B", ROOT / "scripts/check-support.py"], build, "source-support")
            frozen_support = build / "frozen-support"
            approved = support_module["copy_approved"](ROOT / "assets/support", frozen_support)
            report["support"] = {"enabled": True, "files": approved, "privateImagesExcludedFromSource": True}
        go = resolve_go(args.go)
        default_fnpack = Path.home() / ".cache/fontbull/tools/fnpack-1.2.3-darwin-arm64" if args.publish else ROOT / "build/20261121-core-01/toolchain/fnpack"
        fnpack = (args.fnpack or default_fnpack).resolve()
        expected_fnpack = PINNED_PUBLISH_FNPACK if args.publish else PINNED_FNPACK
        if sha(fnpack) != expected_fnpack:
            raise ValueError("Selected fnpack does not match the inspected official tool for this packaging mode")
        env = dict(os.environ, GOPROXY="off", GOSUMDB="off", GOTOOLCHAIN="local", CGO_ENABLED="0")
        report["tools"] = {"goVersion": run([go, "version"], build, "go-version").strip(),
                           "fnpackSHA256": sha(fnpack), "fnpackIdentity": run([fnpack, "--help"], build, "fnpack-identity").strip(),
                           "fnpackBuildHelp": run([fnpack, "build", "--help"], build, "fnpack-build-help").strip()}
        if args.release:
            if args.key:
                report["signingContext"] = {"mode": "explicit-existing-paths", "credentialsValidatedBy": "official fnpack", "privateKeysReadByAssistant": False}
            else:
                status = run([fnpack, "cert", "status"], build, "fnpack-cert-status")
                report["signingContext"] = signing_preflight(status)
        if "go1.26." not in report["tools"]["goVersion"]:
            raise ValueError("Go 1.26 toolchain required")
        run([sys.executable, "-I", "-B", ROOT / "scripts/check-assets.py"], build, "source-assets")
        run([sys.executable, "-I", "-B", args.checker, ROOT, "--package-root", ROOT / "packaging/fnos"], build, "source-official-check")
        for hook in (ROOT / "packaging/fnos/cmd").iterdir():
            if hook.is_file():
                run(["/bin/sh", "-n", hook], build, "syntax-" + hook.name)
        if not args.skip_web:
            run(["npm", "run", "build"], build, "web-build", cwd=ROOT / "web")
        if not (ROOT / "web/dist/index.html").is_file():
            raise ValueError("Compiled web/dist is missing")
        report["webFiles"] = {p.relative_to(ROOT / "web/dist").as_posix(): sha(p) for p in sorted((ROOT / "web/dist").rglob("*")) if p.is_file()}
        shutil.copytree(ROOT / "web/dist", build / "frozen-web")
        source_module = runpy.run_path(str(ROOT / "scripts/make-source.py"))
        before = source_module["files_manifest"]()
        report["sourceTreeSHA256"] = source_module["tree_digest"](before)
        run([sys.executable, "-I", "-B", ROOT / "scripts/collect-notices.py", "--output", build / "notices", "--go", go], build, "dependency-notices")
        run([sys.executable, "-I", "-B", ROOT / "scripts/make-source.py", "--output", build / "source/source.zip", "--build-id", args.build_id, "--notices", build / "notices"], build, "source-snapshot")
        test_command = [sys.executable, "-I", "-B", ROOT / "tests/support-packaging.py", "--evidence", build / "support-tests", "--source-zip", build / "source/source.zip"]
        if args.without_support:
            test_command.append("--without-support")
        run(test_command, build, "support-tests")
        report["source"] = json.loads((build / "source/source-record.json").read_text())
        if report["source"]["treeSHA256"] != report["sourceTreeSHA256"]:
            raise ValueError("Sources changed before compilation; retry using a new build ID after freeze")
        workspace = build / "workspace"
        source_copy(workspace, source_module)
        shutil.copytree(build / "frozen-web", workspace / "web/dist")
        for name, expected in before.items():
            if sha(workspace / name) != expected:
                raise ValueError(f"Immutable compilation source differs from the source ZIP: {name}")
        # Tests create short local Unix socket paths on macOS. Run against the
        # immutable workspace via a short owned alias, not the mutable live tree.
        alias = ROOT / (".qa-" + uuid.uuid4().hex[:6])
        alias.symlink_to(workspace, target_is_directory=True)
        try:
            run([go, "test", "-mod=readonly", "./cmd/...", "./internal/...", "./packaging/fnos/helpers/..."], build, "go-tests", env=dict(env, PWD=str(alias)), cwd=alias)
            run(["node", workspace / "tests/game-catalog.mjs", build / "game-tests"], build, "game-catalog-tests", cwd=workspace)
            local = build / "local-server"
            run([go, "-C", workspace, "build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags", f"-X main.version={version} -X main.buildID={args.build_id}", "-o", local, "./cmd/xiaoniubawang"], build, "compile-local-tests", env=env)
            run(["node", workspace / "tests/server-roundtrip.mjs", local, build / "server-roundtrip"], build, "server-roundtrip", cwd=workspace)
        finally:
            alias.unlink(missing_ok=True)
        package_module = runpy.run_path(str(ROOT / "scripts/check-package.py"))
        for arch in ("amd64", "arm64"):
            stage = build / "stage" / ("linux-" + arch)
            shutil.copytree(ROOT / "packaging/fnos", stage, ignore=shutil.ignore_patterns("helpers"))
            support_module["stage_support"](stage, None if args.without_support else frozen_support, args.without_support)
            text = (stage / "manifest").read_text().replace("@PLATFORM@", {"amd64": "x86", "arm64": "arm"}[arch])
            (stage / "manifest").write_text(text)
            web = stage / "app/web/dist"
            shutil.copytree(build / "frozen-web", web)
            shutil.copytree(build / "notices/licenses", web / "licenses", dirs_exist_ok=True)
            shutil.copy2(build / "notices/LICENSES.txt", web / "LICENSES.txt")
            (web / "source").mkdir()
            shutil.copy2(build / "source/source.zip", web / "source/source.zip")
            server = stage / "app/server"
            server.mkdir(parents=True)
            target_env = dict(env, GOOS="linux", GOARCH=arch, GOAMD64="v1", GOARM64="v8.0")
            for name, package in (("xiaoniubawang", "./cmd/xiaoniubawang"), ("procguard", "./packaging/fnos/helpers/procguard")):
                command = [go, "-C", workspace, "build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags", f"-s -w -buildid= -X main.version={version} -X main.buildID={args.build_id}", "-o", server / name, package]
                run(command, build, "compile-" + arch + "-" + name, env=target_env)
                metadata = run([go, "version", "-m", server / name], build, "binary-metadata-" + arch + "-" + name, env=env)
                for expected in ("CGO_ENABLED=0", "GOOS=linux", "GOARCH=" + arch, ("GOAMD64=v1" if arch == "amd64" else "GOARM64=v8.0")):
                    if expected not in metadata:
                        raise ValueError(f"Binary build metadata does not prove {expected}: {name}")
                os.chmod(server / name, 0o755)
            support_flags = ["--without-support"] if args.without_support else []
            mode_flags = ["--publish"] if args.publish else ["--release"] if args.release else ["--nosign"]
            run([sys.executable, "-I", "-B", ROOT / "scripts/check-package.py", "--stage", stage, "--arch", arch, "--report", build / ("stage-" + arch + ".json")] + support_flags + mode_flags, build, "stage-check-" + arch)
            official_gate(stage, None, arch, build, "stage-official-" + arch, args.checker)
            rawdir = build / "raw" / arch
            rawdir.mkdir(parents=True)
            output = run(fnpack_command(fnpack, stage, args.release, args.key, args.cert, args.publish), build, "fnpack-" + arch, cwd=rawdir)
            if "packing successfully" not in output.lower() or "packing failed" in output.lower():
                raise ValueError("fnpack did not confirm successful packing; exit zero alone is not success")
            if args.publish and re.search(r"local debug|do not distribute|do not.*publish", output, re.I):
                raise ValueError("A tool-declared debug package cannot be an ordinary publication candidate")
            rawfiles = list(rawdir.glob("*.fpk"))
            if len(rawfiles) != 1:
                raise ValueError("fnpack must emit exactly one raw FPK per architecture")
            candidates = build / "candidates"
            candidates.mkdir(exist_ok=True)
            suffix = "signed" if args.release else "unsigned-local"
            candidate = candidates / f"xiaoniubawang-{version}-{arch}-{suffix}.fpk"
            supplemental = (signed_candidate(rawfiles[0], stage, candidate, package_module, args.cert) if args.release
                            else supplement_unsigned(rawfiles[0], stage, candidate, package_module, args.publish))
            save(build / ("raw-fnpack-" + arch + ".json"), supplemental)
            certificate_flags = ["--expected-certificate", args.cert] if args.release and args.cert else []
            run([sys.executable, "-I", "-B", ROOT / "scripts/check-package.py", "--stage", stage, "--arch", arch, "--package", candidate, "--report", build / ("package-" + arch + ".json")] + support_flags + mode_flags + certificate_flags, build, "package-check-" + arch)
            official_gate(stage, candidate, arch, build, "package-official-" + arch, args.checker)
            item = json.loads((build / ("package-" + arch + ".json")).read_text())
            item["rawFnpack"] = supplemental
            report["packages"].append(item)
        if not args.without_support:
            support_module["check_directory"](ROOT / "assets/support")
            support_module["check_directory"](frozen_support)
        if before != source_module["files_manifest"]():
            raise ValueError("Live sources changed during build; no dist link was updated. Rebuild after freeze.")
        if any(sha(workspace / name) != expected for name, expected in before.items()):
            raise ValueError("Immutable compilation source changed during build")
        current_web = {p.relative_to(ROOT / "web/dist").as_posix(): sha(p) for p in sorted((ROOT / "web/dist").rglob("*")) if p.is_file()}
        if report["webFiles"] != current_web:
            raise ValueError("Compiled web output changed during build; no dist link was updated")
        if report["packages"][0]["source"]["sha256"] != report["packages"][1]["source"]["sha256"]:
            raise ValueError("Architecture source ZIPs differ")
        report["delivery"] = deliver(build, report["packages"], version)
        report["packageReady"] = True
        report["signed"] = all(item["signing"] == "official-fnpack-signed" for item in report["packages"])
        report["releaseReady"] = False  # Signing is not device acceptance or publication approval.
        if not args.no_deliver:
            report["dist"] = publish_pointer(build)
        report["ok"] = True
        print(f"Build passed: {build}", flush=True)
        for item in report["delivery"]:
            print(f"{item['sha256']}  {build / 'delivery' / item['filename']}", flush=True)
    except Exception as error:
        report["error"] = str(error)
        print(str(error), file=sys.stderr, flush=True)
        return 1
    finally:
        save(build / "final-verification.json", report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
