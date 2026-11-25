#!/usr/bin/env python3
"""Focused offline support packaging regressions; never builds FPKs or runs a service."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SUPPORT = runpy.run_path(str(ROOT / "scripts/check-support.py"))
SOURCE = runpy.run_path(str(ROOT / "scripts/make-source.py"))
PACKAGE = runpy.run_path(str(ROOT / "scripts/check-package.py"))
BUILD = runpy.run_path(str(ROOT / "scripts/build.py"))


class SupportPackagingTests(unittest.TestCase):
    evidence = None
    notices = None
    source_zip = None
    without_support = False

    def setUp(self):
        private_cases = {"test_exact_originals_stage_regular_0644", "test_mutation_rejected", "test_extra_hidden_file_and_directory_rejected", "test_missing_original_rejected", "test_image_symlink_and_hardlink_rejected", "test_permissions_rejected_and_0600_accepted", "test_support_and_disabled_marker_cannot_coexist", "test_archive_support_exact_and_negatives"}
        if self.without_support and self._testMethodName in private_cases:
            self.skipTest("explicit source-only mode: private support originals intentionally excluded")
        self.temporary = tempfile.TemporaryDirectory(prefix="support-case-", dir=self.evidence)
        self.fixture = Path(self.temporary.name)
        self.stage = self.fixture / "stage"
        self.stage.mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def approved(self):
        return SUPPORT["stage_support"](self.stage)

    def rejected(self, operation, phrase):
        with self.assertRaisesRegex(ValueError, phrase):
            operation()

    def test_exact_originals_stage_regular_0644(self):
        result = self.approved()
        self.assertTrue(result["enabled"])
        self.assertEqual(set(result["files"]), set(SUPPORT["APPROVED_FILES"]))
        for name in result["files"]:
            self.assertEqual((self.stage / "app/support" / name).read_bytes(), (ROOT / "assets/support" / name).read_bytes())
            self.assertEqual(result["files"][name]["mode"], "0644")

    def test_mutation_rejected(self):
        self.approved()
        path = self.stage / "app/support/wechat-6uos.jpg"
        data = bytearray(path.read_bytes())
        data[-1] ^= 1
        path.write_bytes(data)
        self.rejected(lambda: SUPPORT["check_stage"](self.stage), "bytes changed")

    def test_extra_hidden_file_and_directory_rejected(self):
        self.approved()
        for name, directory in (("extra.jpg", False), (".hidden", False), ("nested", True)):
            path = self.stage / "app/support" / name
            path.mkdir() if directory else path.write_bytes(b"not approved")
            self.rejected(lambda: SUPPORT["check_stage"](self.stage), "exactly the two")
            path.rmdir() if directory else path.unlink()

    def test_missing_original_rejected(self):
        self.approved()
        (self.stage / "app/support/alipay-6uos.jpg").unlink()
        self.rejected(lambda: SUPPORT["check_stage"](self.stage), "exactly the two")

    def test_image_symlink_and_hardlink_rejected(self):
        self.approved()
        path = self.stage / "app/support/wechat-6uos.jpg"
        path.unlink()
        path.symlink_to(ROOT / "assets/support/wechat-6uos.jpg")
        self.rejected(lambda: SUPPORT["check_stage"](self.stage), "regular, single-link")
        path.unlink()
        original = self.fixture / "original.jpg"
        shutil.copy2(ROOT / "assets/support/wechat-6uos.jpg", original)
        os.link(original, path)
        self.rejected(lambda: SUPPORT["check_stage"](self.stage), "regular, single-link")

    def test_directory_symlink_rejected(self):
        (self.stage / "app").mkdir()
        (self.stage / "app/support").symlink_to(ROOT / "assets/support", target_is_directory=True)
        self.rejected(lambda: SUPPORT["check_stage"](self.stage), "missing or unsafe")

    def test_permissions_rejected_and_0600_accepted(self):
        self.approved()
        path = self.stage / "app/support/wechat-6uos.jpg"
        for mode in (0o666, 0o755, 0o4644):
            path.chmod(mode)
            self.rejected(lambda: SUPPORT["check_stage"](self.stage), "0600/0644")
        path.chmod(0o600)
        self.assertEqual(SUPPORT["check_stage"](self.stage)["files"][path.name]["mode"], "0600")
        directory = path.parent
        directory.chmod(0o777)
        self.rejected(lambda: SUPPORT["check_stage"](self.stage), "owner-controlled")

    def test_explicit_without_support_only(self):
        self.rejected(lambda: SUPPORT["check_stage"](self.stage), "missing or unsafe")
        self.rejected(lambda: SUPPORT["check_stage"](self.stage, True), "Missing approved support file")
        result = SUPPORT["stage_support"](self.stage, without_support=True)
        self.assertFalse(result["enabled"])
        self.rejected(lambda: SUPPORT["check_stage"](self.stage), "must not contain a support-disabled")
        disabled = self.stage / "app" / SUPPORT["DISABLED_NAME"]
        disabled.write_bytes(b"silently disabled\n")
        self.rejected(lambda: SUPPORT["check_stage"](self.stage, True), "does not prove")

    def test_support_and_disabled_marker_cannot_coexist(self):
        self.approved()
        (self.stage / "app" / SUPPORT["DISABLED_NAME"]).write_bytes(SUPPORT["DISABLED_BYTES"])
        self.rejected(lambda: SUPPORT["check_stage"](self.stage), "must not contain")
        self.rejected(lambda: SUPPORT["check_stage"](self.stage, True), "must not contain a support directory")

    def test_approval_configuration_pinned(self):
        namespace = SUPPORT["approval"].__globals__
        previous = namespace["ROOT"]
        scripts = self.fixture / "scripts"
        scripts.mkdir()
        shutil.copy2(ROOT / "scripts/support-assets-approved.json", scripts)
        (self.fixture / "branding").mkdir()
        brand_path = self.fixture / "branding/brand.json"
        brand_path.write_text(json.dumps({"id": "xiaoniubawang", "version": "0.2.0"}))
        try:
            namespace["ROOT"] = self.fixture
            self.assertEqual(SUPPORT["approval"]()["files"], SUPPORT["APPROVED_FILES"])
            self.assertEqual(SUPPORT["approval"]()["version"], "0.1.0")
            brand_path.write_text(json.dumps({"id": "unapproved-other-app", "version": "0.2.0"}))
            self.rejected(SUPPORT["approval"], "frozen application approval")
            brand_path.write_text(json.dumps({"id": "xiaoniubawang", "version": "0.2.0"}))
            path = scripts / "support-assets-approved.json"
            value = json.loads(path.read_text())
            value["files"]["wechat-6uos.jpg"]["sha256"] = "0" * 64
            path.write_text(json.dumps(value))
            self.rejected(SUPPORT["approval"], "frozen application approval")
        finally:
            namespace["ROOT"] = previous

    def test_source_selection_excludes_private_originals_but_includes_approval(self):
        names = {p.relative_to(ROOT).as_posix() for p in SOURCE["selected_files"]()}
        self.assertIn("scripts/check-support.py", names)
        self.assertIn("scripts/support-assets-approved.json", names)
        self.assertIn("packaging/fnos/cmd/main", names)
        self.assertFalse(any("support" in Path(name).parts or Path(name).name in SUPPORT["APPROVED_FILES"] for name in names))

    def test_source_zip_rejects_private_images_even_outside_support(self):
        for name in ("assets/support/wechat-6uos.jpg", "web/public/wechat-6uos.jpg", "web/public/donation/other.jpg"):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, "w") as archive:
                archive.writestr("xiaoniubawang/" + name, b"private")
            self.rejected(lambda: PACKAGE["check_source_zip"](stream.getvalue()), "Forbidden source ZIP path")

    def test_lifecycle_exact_flags_and_runtime_guard(self):
        lifecycle = (ROOT / "packaging/fnos/cmd/main").read_text()
        self.assertIn('set -- "$@" --support-root "$SUPPORT_ROOT" --approve-support-assets', lifecycle)
        self.assertIn('if [ "$SUPPORT_ENABLED" -eq 1 ]; then', lifecycle)
        self.assertIn('"$GUARD" verify-support "$APP_DIR"', lifecycle)
        self.assertIn('set -- "$@" --without-support-assets', lifecycle)
        self.assertNotIn("support_assets || return 1", lifecycle)
        self.assertNotIn("--dev-user", lifecycle)
        self.assertNotIn("--listen", lifecycle)
        subprocess.run(["/bin/sh", "-n", ROOT / "packaging/fnos/cmd/main"], check=True)
        # Verify native helper exit-code wiring without running a service.
        guard = lifecycle[lifecycle.index("support_assets() {"):lifecycle.index("\nstart() {")]
        script_dir = self.fixture / "test-scripts"
        script_dir.mkdir()
        helper = script_dir / "procguard"
        helper.write_text('#!/bin/sh\n[ "$1" = verify-support ] || exit 9\n[ "$2" = "$APP_DIR" ] || exit 9\n[ "$GUARD_RESULT" -ne 0 ] || printf "%s\\n" "$CANONICAL_APP"\nexit "$GUARD_RESULT"\n')
        helper.chmod(0o755)
        log = self.fixture / "runtime.log"
        env = dict(os.environ, APP_DIR=str(self.stage / "platform-alias"), CANONICAL_APP=str(self.stage / "actual"), GUARD=str(helper), log_file=str(log))
        code = 'set -eu\n' + guard + '\nsupport_assets\nprintf "%s\\n%s\\n%s\\n" "$SUPPORT_ENABLED" "$SUPPORT_ROOT" "$SUPPORT_DISABLED"\n'
        for helper_result, enabled in ((0, "1"), (3, "0"), (4, "0"), (127, "0")):
            result = subprocess.run(["/bin/sh", "-c", code], env=dict(env, GUARD_RESULT=str(helper_result)), capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.splitlines()[0], enabled)
            self.assertEqual(result.stdout.splitlines()[1], str(self.stage / "actual/support") if helper_result == 0 else "")
            self.assertEqual(result.stdout.splitlines()[2], "1" if helper_result == 3 else "0")
        self.assertIn("核心功能不受影响", log.read_text())

    def test_archive_support_exact_and_negatives(self):
        def archive_check(prefix, extra=None, mutated=False):
            stream = io.BytesIO()
            with tarfile.open(fileobj=stream, mode="w") as archive:
                directory = tarfile.TarInfo(prefix + "support")
                directory.type, directory.mode = tarfile.DIRTYPE, 0o755
                archive.addfile(directory)
                for name in SUPPORT["APPROVED_FILES"]:
                    data = (ROOT / "assets/support" / name).read_bytes()
                    if mutated and name == "wechat-6uos.jpg":
                        data = data[:-1] + bytes([data[-1] ^ 1])
                    member = tarfile.TarInfo(prefix + "support/" + name)
                    member.size, member.mode = len(data), 0o644
                    archive.addfile(member, io.BytesIO(data))
                if extra:
                    member = tarfile.TarInfo(prefix + "support/" + extra)
                    member.mode = 0o755
                    member.type = tarfile.DIRTYPE if extra == "nested" else tarfile.SYMTYPE
                    member.linkname = "wechat-6uos.jpg" if member.issym() else ""
                    archive.addfile(member)
            with tarfile.open(fileobj=io.BytesIO(stream.getvalue()), mode="r") as archive:
                PACKAGE["check_support_archive"](archive, prefix, True)
        for prefix in ("", "app/"):
            archive_check(prefix)
            self.rejected(lambda: archive_check(prefix, "nested"), "Unapproved support archive path")
            self.rejected(lambda: archive_check(prefix, "linked.jpg"), "Unapproved support archive path")
            self.rejected(lambda: archive_check(prefix, mutated=True), "archive bytes changed")

    def test_dynamic_version_manifest_source_and_delivery(self):
        brand = SOURCE["application_brand"]()
        self.assertEqual(brand["version"], "0.3.1")
        text = (ROOT / "packaging/fnos/manifest").read_text().replace("@PLATFORM@", "x86")
        self.assertEqual(PACKAGE["manifest"](text, "amd64")["version"], brand["version"])
        self.rejected(lambda: PACKAGE["manifest"](text.replace(f"version={brand['version']}", "version=0.1.0"), "amd64"), "Wrong manifest version")
        self.rejected(lambda: PACKAGE["manifest"](text.replace(next(line for line in text.splitlines() if line.startswith("desc=")), "desc=plain text"), "amd64"), "rich HTML")
        build = self.fixture / "build"
        (build / "source").mkdir(parents=True)
        (build / "notices").mkdir()
        (build / "source/source.zip").write_bytes(b"source fixture")
        (build / "notices/LICENSES.txt").write_bytes(b"licenses fixture")
        (build / "candidates").mkdir()
        packages = []
        for arch in ("amd64", "arm64"):
            package = build / "candidates" / (arch + ".fpk")
            package.write_bytes(("never an actual FPK: " + arch).encode())
            packages.append({"package": package, "architecture": arch, "sha256": BUILD["sha"](package),
                             "ok": True, "signing": "unsigned-local-debug",
                             "source": {"sha256": BUILD["sha"](build / "source/source.zip"),
                                        "version": brand["version"], "buildId": build.name}})
        records = BUILD["deliver"](build, packages, brand["version"])
        self.assertEqual([item["filename"] for item in records], ["小牛霸王学习机-x86_64.fpk", "小牛霸王学习机-ARM64.fpk", "小牛霸王学习机-源码.zip", "开源许可.txt"])
        self.assertEqual(json.loads((build / "delivery/交付清单.json").read_text())["version"], brand["version"])
        self.assertFalse(json.loads((build / "delivery/交付清单.json").read_text())["releaseReady"])

    def test_mode_cli_and_official_release_command(self):
        for arguments in ([], ["--release", "--nosign"], ["--release", "--without-support"], ["--publish", "--nosign"], ["--publish", "--without-support"], ["--publish", "--key", "not-read.key", "--cert", "not-read.crt"], ["--nosign", "--key", "not-read.key", "--cert", "not-read.crt"]):
            result = subprocess.run([sys.executable, "-I", "-B", ROOT / "scripts/build.py", *arguments], text=True, capture_output=True)
            self.assertEqual(result.returncode, 2)
        self.assertNotIn("--nosign", BUILD["fnpack_command"]("fnpack", self.stage, True))
        self.assertIn("--nosign", BUILD["fnpack_command"]("fnpack", self.stage, False))
        self.assertEqual(BUILD["fnpack_command"]("fnpack", self.stage, False, publish=True), ["fnpack", "build", "--directory", self.stage])
        self.assertEqual(BUILD["fnpack_command"]("fnpack", self.stage, True, "existing.key", "existing.crt")[-4:], ["--key", "existing.key", "--cert", "existing.crt"])
        self.rejected(lambda: BUILD["signing_preflight"]("Developer certificate is not configured.\nKey: missing\nCert: missing"), "RELEASE_KEY_MISSING,RELEASE_CERTIFICATE_MISSING.*selected fnpack")
        self.rejected(lambda: BUILD["signing_preflight"]("unknown"), "STATUS_UNRECOGNIZED")

    def raw_fixture(self, extra=None, with_icon=False):
        (self.stage / "ICON_512.PNG").write_bytes(b"exact approved icon fixture")
        (self.stage / "cmd").mkdir()
        (self.stage / "config").mkdir()
        (self.stage / "wizard").mkdir()
        raw = self.fixture / "raw.fpk"
        files = {"manifest": b"fixture", "ICON.PNG": b"256", "ICON_256.PNG": b"256", "app.tgz": b"payload"}
        if with_icon:
            files["ICON_512.PNG"] = (self.stage / "ICON_512.PNG").read_bytes()
        if extra:
            files.update(extra)
        with tarfile.open(raw, "w:gz") as archive:
            for name, data in files.items():
                member = tarfile.TarInfo(name)
                member.size, member.mode = len(data), 0o644
                archive.addfile(member, io.BytesIO(data))
        return raw

    def test_exact_unsigned512_supplement_preserves_raw(self):
        raw = self.raw_fixture()
        before = raw.read_bytes()
        target = self.fixture / "candidate.fpk"
        result = BUILD["supplement_unsigned"](raw, self.stage, target, PACKAGE)
        self.assertTrue(result["supplemented"])
        self.assertEqual(raw.read_bytes(), before)
        with tarfile.open(target) as archive:
            members = PACKAGE["inventory"](archive)
            self.assertEqual(PACKAGE["read"](archive, members, "ICON_512.PNG"), (self.stage / "ICON_512.PNG").read_bytes())

    def test_signed512_missing_never_mutates(self):
        raw = self.raw_fixture({"signature.json": b"{}", "checksums.json": b"{}"})
        before = raw.read_bytes()
        target = self.fixture / "candidate.fpk"
        self.rejected(lambda: BUILD["supplement_unsigned"](raw, self.stage, target, PACKAGE), "Unknown or signed")
        self.rejected(lambda: BUILD["signed_candidate"](raw, self.stage, target, PACKAGE), "RELEASE_ICON512_MISSING")
        self.assertEqual(raw.read_bytes(), before)
        self.assertFalse(target.exists())

    def test_signed_metadata_presence_is_not_signature_proof(self):
        raw = self.raw_fixture({"signature.json": b"{}", "checksums.json": b"{}"}, with_icon=True)
        before = raw.read_bytes()
        target = self.fixture / "candidate.fpk"
        self.rejected(lambda: BUILD["signed_candidate"](raw, self.stage, target, PACKAGE), "RELEASE_SIGNATURE_UNVERIFIABLE")
        self.assertEqual(raw.read_bytes(), before)
        self.assertFalse(target.exists())

    def test_unsigned_with512_cannot_smuggle_signature(self):
        raw = self.raw_fixture({"signature.json": b"{}"}, with_icon=True)
        self.rejected(lambda: BUILD["supplement_unsigned"](raw, self.stage, self.fixture / "candidate.fpk", PACKAGE), "Unknown or signed")

    def test_real_corresponding_source_zip_exclusion(self):
        if self.source_zip:
            output = self.source_zip
            record = {"sha256": hashlib.sha256(output.read_bytes()).hexdigest()}
        else:
            if not self.notices:
                self.skipTest("pass --notices to create a complete source ZIP, or --source-zip to verify one")
            output = self.evidence / "source/source.zip"
            core = ROOT / "build/20261121-core-01/emulator/xiaoniubawang-fceumm-corresponding-source.tar.gz"
            if not core.is_file():
                core = ROOT / "distribution/core-corresponding-source.tar.gz"
            with contextlib.redirect_stdout(io.StringIO()):
                record = SOURCE["make"](output, "20261122-support-complete-01", self.notices, core)
        with zipfile.ZipFile(output) as archive:
            names = archive.namelist()
            self.assertIn("xiaoniubawang/scripts/support-assets-approved.json", names)
            self.assertFalse(any("support" in Path(name).parts or Path(name).name in SUPPORT["APPROVED_FILES"] for name in names))
            private_hashes = {v["sha256"] for v in SUPPORT["APPROVED_FILES"].values()}
            self.assertFalse(any(hashlib.sha256(archive.read(name)).hexdigest() in private_hashes for name in names))
            frozen_brand = json.loads(archive.read("xiaoniubawang/branding/brand.json"))
            source_manifest = json.loads(archive.read("xiaoniubawang/SOURCE-MANIFEST.json"))
            self.assertEqual(source_manifest["version"], frozen_brand["version"])
        result = PACKAGE["check_source_zip"](output.read_bytes())
        self.assertEqual(result["sha256"], record["sha256"])
        self.assertTrue(result["buildId"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, required=True, help="new isolated project build directory for logs and fixtures")
    parser.add_argument("--notices", type=Path, help="existing dependency notices for optional full source ZIP exclusion test")
    parser.add_argument("--source-zip", type=Path, help="verify an existing complete source ZIP instead of creating another")
    parser.add_argument("--without-support", action="store_true", help="source-only: skip only tests requiring excluded private originals")
    args = parser.parse_args()
    args.evidence.mkdir(parents=True, exist_ok=False)
    SupportPackagingTests.evidence = args.evidence
    SupportPackagingTests.notices = args.notices
    SupportPackagingTests.source_zip = args.source_zip
    SupportPackagingTests.without_support = args.without_support
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(SupportPackagingTests)
    with (args.evidence / "support-tests.log").open("x") as logfile:
        result = unittest.TextTestRunner(stream=logfile, verbosity=2).run(suite)
    summary = {"ok": result.wasSuccessful(), "testsRun": result.testsRun, "failures": len(result.failures),
               "errors": len(result.errors), "skipped": len(result.skipped), "fpkBuilt": False, "remoteOperations": False}
    (args.evidence / "support-verification.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    raise SystemExit(0 if result.wasSuccessful() else 1)
