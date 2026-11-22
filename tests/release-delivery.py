#!/usr/bin/env python3
"""Isolated, offline delivery regressions; never run build.main or real publication."""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import unittest
from unittest import mock
import uuid

PROJECT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("release_delivery_build", PROJECT / "scripts/build.py")
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)
EVIDENCE = None
OWNER = "xiaoniubawang-release-delivery-tests/v1"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def tree_snapshot(directory):
    result = {}
    for root, dirs, files in os.walk(directory, followlinks=False):
        for name in sorted(dirs + files):
            path = Path(root) / name
            key = path.relative_to(directory).as_posix()
            if path.is_symlink():
                result[key] = {"symlink": os.readlink(path)}
            elif path.is_file():
                result[key] = {"sha256": BUILD.sha(path)}
            elif not path.is_dir():
                raise ValueError("Nonregular fixture entry")
    return result


def cleanup_owned_fixture(root, token):
    # Inspect ownership and every entry BEFORE removing anything. rmtree never
    # follows symlinks, but an escaped link is still an unexpected fixture.
    if root.is_symlink() or not root.is_relative_to(EVIDENCE / "夹具") or root.parent != EVIDENCE / "夹具":
        raise ValueError("Unowned fixture cleanup refused")
    marker = root / ".fixture-owner.json"
    if marker.is_symlink() or json.loads(marker.read_text()) != {"owner": OWNER, "token": token}:
        raise ValueError("Fixture owner differs; cleanup refused")
    snapshot = tree_snapshot(root)
    for name in snapshot:
        path = root / name
        if path.is_symlink() and not path.resolve(strict=False).is_relative_to(root):
            raise ValueError("Escaped fixture symlink; cleanup refused")
        if not path.is_symlink() and not (path.is_file() or path.is_dir()):
            raise ValueError("Unexpected fixture entry; cleanup refused")
    shutil.rmtree(root)
    return snapshot


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.token = uuid.uuid4().hex
        self.root = EVIDENCE / "夹具" / (self.id().split(".")[-1] + "-" + self.token[:8])
        self.root.mkdir()
        (self.root / ".fixture-owner.json").write_text(json.dumps({"owner": OWNER, "token": self.token}))
        self.root_patch = mock.patch.object(BUILD, "ROOT", self.root)
        self.root_patch.start()
        self.root.joinpath("开发存档/上架发布/构建").mkdir(parents=True)
        (self.root / "build").symlink_to("开发存档", target_is_directory=True)
        self.archives = self.root / "开发存档/上架发布/构建"

    def tearDown(self):
        try:
            snapshot = cleanup_owned_fixture(self.root, self.token)
            (EVIDENCE / "夹具清理记录" / (self.id().split(".")[-1] + ".json")).write_text(
                json.dumps({"owner": OWNER, "inspectedBeforeDeletion": True, "files": snapshot}, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
        finally:
            self.root_patch.stop()

    def inputs(self, label="first", signing="unsigned-local-debug"):
        build = self.archives / ("20261123-fpk-" + label)
        build.mkdir()
        (build / "source").mkdir()
        (build / "source/source.zip").write_bytes(("source-" + label).encode())
        (build / "notices").mkdir()
        (build / "notices/LICENSES.txt").write_bytes(b"fixture-only licenses\n")
        (build / "candidates").mkdir()
        packages = []
        for architecture in ("arm64", "amd64"):
            path = build / "candidates" / (architecture + ".fpk")
            path.write_bytes(("fixture-only-" + label + "-" + architecture).encode())
            packages.append({"architecture": architecture, "package": str(path), "sha256": BUILD.sha(path),
                             "ok": True, "signing": signing,
                             "source": {"sha256": BUILD.sha(build / "source/source.zip"), "version": "0.2.0", "buildId": build.name}})
        return build, packages

    def staged(self, label="first", signing="unsigned-local-debug"):
        build, packages = self.inputs(label, signing)
        records = BUILD.deliver(build, packages, "0.2.0")
        return build, packages, records

    def published(self):
        build, packages, records = self.staged()
        BUILD.publish_pointer(build)
        (self.root / "dist").symlink_to("最新安装包", target_is_directory=True)
        return build, packages, records

    def reject_preserving_latest(self, build, action=None):
        before = tree_snapshot(self.root / "最新安装包") if (self.root / "最新安装包").is_dir() else tree_snapshot(self.root)
        with self.assertRaises((ValueError, OSError, TypeError, KeyError)):
            (action or (lambda: BUILD.publish_pointer(build)))()
        after = tree_snapshot(self.root / "最新安装包") if (self.root / "最新安装包").is_dir() else tree_snapshot(self.root)
        self.assertEqual(before, after)

    def test_chinese_filenames_and_exact_candidate_source_license_bytes(self):
        build, packages, records = self.staged()
        self.assertEqual({item["filename"] for item in records}, set(BUILD.DELIVERY_NAMES.values()) | {BUILD.DELIVERY_SOURCE, BUILD.DELIVERY_LICENSE})
        for item in packages:
            self.assertEqual(Path(item["package"]).read_bytes(), (build / "delivery" / BUILD.DELIVERY_NAMES[item["architecture"]]).read_bytes())
        self.assertEqual((build / "source/source.zip").read_bytes(), (build / "delivery" / BUILD.DELIVERY_SOURCE).read_bytes())
        self.assertEqual((build / "notices/LICENSES.txt").read_bytes(), (build / "delivery" / BUILD.DELIVERY_LICENSE).read_bytes())
        self.assertEqual(len(BUILD.inspect_delivery(build / "delivery")), 7)

    def test_no_deliver_staging_never_changes_latest_or_dist(self):
        self.published()
        before = tree_snapshot(self.root / "最新安装包")
        link_inode = (self.root / "dist").lstat().st_ino
        self.staged("second")
        self.assertEqual(before, tree_snapshot(self.root / "最新安装包"))
        self.assertEqual(link_inode, (self.root / "dist").lstat().st_ino)

    def test_publish_real_folder_preserves_correct_alias_and_old_contents(self):
        old, _, _ = self.published()
        previous = tree_snapshot(self.root / "最新安装包")
        inode = (self.root / "dist").lstat().st_ino
        next_build, _, _ = self.staged("second")
        staged = BUILD.delivery_snapshot(next_build / "delivery")
        info = BUILD.publish_pointer(next_build)
        self.assertFalse((self.root / "最新安装包").is_symlink())
        self.assertEqual(staged, BUILD.delivery_snapshot(self.root / "最新安装包"))
        self.assertEqual(previous, tree_snapshot(next_build / "previous-delivery"))
        self.assertEqual(previous, tree_snapshot(old / "delivery"))
        self.assertEqual(inode, (self.root / "dist").lstat().st_ino)
        self.assertEqual(os.readlink(self.root / "dist"), "最新安装包")
        self.assertTrue(info["realDirectory"])
        self.assertFalse(any(path.name.startswith(".delivery-publish-") for path in self.root.iterdir()))

    def test_missing_dist_not_created(self):
        build, _, _ = self.staged()
        BUILD.publish_pointer(build)
        self.assertFalse((self.root / "dist").exists())
        self.assertFalse((self.root / "dist").is_symlink())
        self.assertEqual({path.name for path in self.root.iterdir()}, {".fixture-owner.json", "开发存档", "build", "最新安装包"})

    def test_legacy_exact_allowlist_can_be_archived_without_rewriting(self):
        latest = self.root / "最新安装包"
        latest.mkdir()
        names = list(BUILD.LEGACY_DELIVERY_SHA256)
        for name in names:
            (latest / name).write_bytes(("fixture-legacy-" + name).encode())
        pinned = BUILD.delivery_snapshot(latest)
        build, _, _ = self.staged()
        with mock.patch.object(BUILD, "LEGACY_DELIVERY_SHA256", pinned):
            BUILD.publish_pointer(build)
        self.assertEqual(pinned, BUILD.delivery_snapshot(build / "previous-delivery"))

    def test_legacy_modified_instructions_refused(self):
        latest = self.root / "最新安装包"
        latest.mkdir()
        for name in BUILD.LEGACY_DELIVERY_SHA256:
            (latest / name).write_bytes(("fixture-legacy-" + name).encode())
        pinned = BUILD.delivery_snapshot(latest)
        (latest / "安装说明.txt").write_bytes(b"modified")
        build, _, _ = self.staged()
        with mock.patch.object(BUILD, "LEGACY_DELIVERY_SHA256", pinned):
            self.reject_preserving_latest(build)
        self.assertFalse((build / "previous-delivery").exists())

    def test_unexpected_latest_file_refused(self):
        self.published()
        (self.root / "最新安装包/用户文件.txt").write_text("preserve me")
        build, _, _ = self.staged("second")
        self.reject_preserving_latest(build)
        self.assertFalse((build / "previous-delivery").exists())
        self.assertFalse(any(build.glob(".delivery-publish-*")))

    def test_unexpected_latest_directory_refused(self):
        self.published()
        (self.root / "最新安装包/用户目录").mkdir()
        build, _, _ = self.staged("second")
        self.reject_preserving_latest(build)

    def test_symlink_member_refused(self):
        self.published()
        path = self.root / "最新安装包" / BUILD.DELIVERY_LICENSE
        path.unlink()
        path.symlink_to(self.archives / "20261123-fpk-first/notices/LICENSES.txt")
        build, _, _ = self.staged("second")
        self.reject_preserving_latest(build)

    def test_latest_symlink_refused(self):
        old, _, _ = self.staged()
        (self.root / "最新安装包").symlink_to(old / "delivery", target_is_directory=True)
        build, _, _ = self.staged("second")
        self.reject_preserving_latest(build)
        self.assertTrue((self.root / "最新安装包").is_symlink())

    def test_dangling_latest_symlink_refused(self):
        build, _, _ = self.staged()
        (self.root / "最新安装包").symlink_to(self.root / "missing", target_is_directory=True)
        self.reject_preserving_latest(build)

    def test_latest_regular_file_refused(self):
        build, _, _ = self.staged()
        (self.root / "最新安装包").write_bytes(b"user file")
        self.reject_preserving_latest(build)

    def test_modified_package_hash_refused(self):
        self.published()
        (self.root / "最新安装包" / BUILD.DELIVERY_NAMES["amd64"]).write_bytes(b"changed package")
        build, _, _ = self.staged("second")
        self.reject_preserving_latest(build)

    def test_modified_metadata_hash_refused(self):
        self.published()
        (self.root / "最新安装包" / BUILD.DELIVERY_INSTRUCTIONS).write_bytes(b"changed instructions")
        build, _, _ = self.staged("second")
        self.reject_preserving_latest(build)

    def test_modified_manifest_even_with_rewritten_checksum_refused(self):
        self.published()
        latest = self.root / "最新安装包"
        manifest = json.loads((latest / BUILD.DELIVERY_MANIFEST).read_text())
        manifest["version"] = "999.0.0"
        (latest / BUILD.DELIVERY_MANIFEST).write_text(BUILD.delivery_json(manifest))
        records = manifest["files"] + [{"filename": BUILD.DELIVERY_MANIFEST, "sha256": BUILD.sha(latest / BUILD.DELIVERY_MANIFEST)}]
        (latest / "SHA256SUMS").write_text(BUILD.delivery_checksums(records))
        build, _, _ = self.staged("second")
        self.reject_preserving_latest(build)

    def test_wrong_dist_alias_preserved(self):
        self.published()
        link = self.root / "dist"
        link.unlink()
        link.symlink_to("build/20261123-fpk-first/delivery", target_is_directory=True)
        build, _, _ = self.staged("second")
        self.reject_preserving_latest(build)
        self.assertEqual(os.readlink(link), "build/20261123-fpk-first/delivery")

    def test_real_dist_preserved(self):
        self.published()
        link = self.root / "dist"
        link.unlink()
        link.mkdir()
        (link / "用户文件.txt").write_text("do not touch")
        build, _, _ = self.staged("second")
        self.reject_preserving_latest(build)
        self.assertEqual((link / "用户文件.txt").read_text(), "do not touch")

    def test_preexisting_previous_archive_refused(self):
        self.published()
        build, _, _ = self.staged("second")
        (build / "previous-delivery").mkdir()
        (build / "previous-delivery/用户文件.txt").write_text("owned by someone else")
        self.reject_preserving_latest(build)

    def test_new_move_failure_rolls_back_exact_old_folder(self):
        self.published()
        before = tree_snapshot(self.root / "最新安装包")
        build, _, _ = self.staged("second")
        original = BUILD.os.rename
        def rename(source, target):
            if Path(source).name.startswith(".delivery-publish-"):
                raise OSError("injected new move failure")
            return original(source, target)
        with mock.patch.object(BUILD.os, "rename", side_effect=rename):
            with self.assertRaisesRegex(OSError, "injected"):
                BUILD.publish_pointer(build)
        self.assertEqual(before, tree_snapshot(self.root / "最新安装包"))
        self.assertFalse((build / "previous-delivery").exists())
        self.assertEqual(len(list(build.glob(".delivery-publish-*"))), 1)

    def test_first_move_failure_preserves_old_folder(self):
        self.published()
        build, _, _ = self.staged("second")
        with mock.patch.object(BUILD.os, "rename", side_effect=OSError("injected archive move failure")):
            self.reject_preserving_latest(build)
        self.assertFalse((build / "previous-delivery").exists())

    def test_postmove_verification_failure_restores_previous(self):
        self.published()
        before = tree_snapshot(self.root / "最新安装包")
        build, _, _ = self.staged("second")
        original = BUILD.inspect_delivery
        calls = 0
        def inspect(path, **kwargs):
            nonlocal calls
            if Path(path) == self.root / "最新安装包":
                calls += 1
                if calls == 3:
                    raise ValueError("injected final verification failure")
            return original(path, **kwargs)
        with mock.patch.object(BUILD, "inspect_delivery", side_effect=inspect):
            with self.assertRaisesRegex(ValueError, "injected"):
                BUILD.publish_pointer(build)
        self.assertEqual(before, tree_snapshot(self.root / "最新安装包"))
        self.assertFalse((build / "previous-delivery").exists())

    def test_staged_tampering_refused_before_latest_move(self):
        self.published()
        build, _, _ = self.staged("second")
        (build / "delivery" / BUILD.DELIVERY_LICENSE).write_bytes(b"modified")
        self.reject_preserving_latest(build)
        self.assertFalse((build / "previous-delivery").exists())

    def test_existing_latest_changed_during_copy_is_preserved(self):
        self.published()
        build, _, _ = self.staged("second")
        original = BUILD.shutil.copyfileobj
        changed = False
        def copy(source, target, *args):
            nonlocal changed
            result = original(source, target, *args)
            if not changed:
                changed = True
                (self.root / "最新安装包/用户新增.txt").write_text("concurrent user content")
            return result
        with mock.patch.object(BUILD.shutil, "copyfileobj", side_effect=copy):
            with self.assertRaises(ValueError):
                BUILD.publish_pointer(build)
        self.assertEqual((self.root / "最新安装包/用户新增.txt").read_text(), "concurrent user content")
        self.assertFalse((build / "previous-delivery").exists())

    def test_previous_archive_appearing_during_copy_is_preserved(self):
        self.published()
        before = tree_snapshot(self.root / "最新安装包")
        build, _, _ = self.staged("second")
        original = BUILD.shutil.copyfileobj
        appeared = False
        def copy(source, target, *args):
            nonlocal appeared
            result = original(source, target, *args)
            if not appeared:
                appeared = True
                (build / "previous-delivery").mkdir()
            return result
        with mock.patch.object(BUILD.shutil, "copyfileobj", side_effect=copy):
            with self.assertRaisesRegex(ValueError, "archive appeared"):
                BUILD.publish_pointer(build)
        self.assertEqual(before, tree_snapshot(self.root / "最新安装包"))
        self.assertTrue((build / "previous-delivery").is_dir())

    def test_archive_anchor_symlink_refused(self):
        old, _, _ = self.published()
        record = old / "delivery-record.json"
        record.rename(old / "record-backup.json")
        record.symlink_to(old / "record-backup.json")
        build, _, _ = self.staged("second")
        self.reject_preserving_latest(build)

    def test_missing_stage_anchor_refused(self):
        build, _, _ = self.staged()
        (build / "delivery-record.json").unlink()
        with self.assertRaises(ValueError):
            BUILD.publish_pointer(build)
        self.assertFalse((self.root / "最新安装包").exists())

    def test_mismatched_package_bytes_rejected_before_stage_creation(self):
        build, packages = self.inputs()
        packages[0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "verified current-build"):
            BUILD.deliver(build, packages, "0.2.0")
        self.assertFalse((build / "delivery").exists())

    def test_unverified_package_rejected(self):
        build, packages = self.inputs()
        packages[0]["ok"] = False
        with self.assertRaises(ValueError):
            BUILD.deliver(build, packages, "0.2.0")

    def test_source_version_build_or_hash_mismatch_rejected(self):
        build, packages = self.inputs()
        for key, value in (("version", "0.1.0"), ("buildId", "other-build"), ("sha256", "0" * 64)):
            with self.subTest(key=key):
                original = packages[0]["source"][key]
                packages[0]["source"][key] = value
                with self.assertRaisesRegex(ValueError, "source differs"):
                    BUILD.deliver(build, packages, "0.2.0")
                packages[0]["source"][key] = original
        self.assertFalse((build / "delivery").exists())

    def test_duplicate_or_missing_architecture_rejected(self):
        build, packages = self.inputs()
        for invalid in (packages[:1], [packages[0], packages[0]]):
            with self.assertRaisesRegex(ValueError, "exactly both"):
                BUILD.deliver(build, invalid, "0.2.0")

    def test_mixed_or_unknown_signing_rejected(self):
        build, packages = self.inputs()
        packages[0]["signing"] = "official-fnpack-signed"
        with self.assertRaisesRegex(ValueError, "Mixed"):
            BUILD.deliver(build, packages, "0.2.0")
        packages[0]["signing"] = "just-trust-me"
        with self.assertRaisesRegex(ValueError, "unrecognized"):
            BUILD.deliver(build, packages, "0.2.0")

    def test_package_from_other_build_refused(self):
        build, packages = self.inputs()
        other, _ = self.inputs("other")
        foreign = other / "candidates/arm64.fpk"
        packages[0]["package"], packages[0]["sha256"] = str(foreign), BUILD.sha(foreign)
        with self.assertRaisesRegex(ValueError, "current-build"):
            BUILD.deliver(build, packages, "0.2.0")

    def test_symlink_input_or_parent_refused(self):
        build, packages = self.inputs()
        path = Path(packages[0]["package"])
        content = path.read_bytes()
        path.unlink()
        target = build / "real.fpk"
        target.write_bytes(content)
        path.symlink_to(target)
        with self.assertRaisesRegex(ValueError, "symlink"):
            BUILD.deliver(build, packages, "0.2.0")
        path.unlink()
        path.write_bytes(content)
        (build / "source/source.zip").rename(build / "source-original.zip")
        (build / "source").rmdir()
        alternate = build / "alternate"
        alternate.mkdir()
        (build / "source-original.zip").rename(alternate / "source.zip")
        (build / "source").symlink_to(alternate, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "symlink"):
            BUILD.deliver(build, packages, "0.2.0")

    def test_existing_stage_never_overwritten(self):
        build, packages, _ = self.staged()
        before = tree_snapshot(build / "delivery")
        with self.assertRaises(FileExistsError):
            BUILD.deliver(build, packages, "0.2.0")
        self.assertEqual(before, tree_snapshot(build / "delivery"))

    def test_invalid_version_or_traversal_rejected(self):
        build, packages = self.inputs()
        with self.assertRaisesRegex(ValueError, "version"):
            BUILD.deliver(build, packages, "0.2.0\nrelease-ready")
        with self.assertRaisesRegex(ValueError, "inside the project"):
            BUILD.delivery_path(build / ".." / build.name, directory=True)
        with self.assertRaisesRegex(ValueError, "inside the project"):
            BUILD.delivery_path(PROJECT / "最新安装包", directory=True)

    def test_metadata_deterministic_with_version_and_honest_unsigned_scopes(self):
        build, _, _ = self.staged()
        manifest_bytes = (build / "delivery" / BUILD.DELIVERY_MANIFEST).read_text()
        manifest = json.loads(manifest_bytes)
        self.assertEqual(manifest_bytes, BUILD.delivery_json(manifest))
        self.assertEqual(manifest["version"], "0.2.0")
        self.assertTrue(manifest["packageReady"])
        self.assertFalse(manifest["signed"])
        self.assertFalse(manifest["releaseReady"])
        self.assertEqual(manifest["deviceValidation"], "not performed")
        self.assertEqual(manifest["publicSubmission"], "not performed")
        self.assertNotIn(str(PROJECT), manifest_bytes)
        instructions = (build / "delivery" / BUILD.DELIVERY_INSTRUCTIONS).read_text()
        self.assertIn("版本：0.2.0", instructions)
        self.assertIn("未签名本地测试包", instructions)
        self.assertIn("设备验收：未执行", instructions)
        checksums = (build / "delivery/SHA256SUMS").read_text()
        self.assertEqual(checksums.splitlines(), sorted(checksums.splitlines(), key=lambda line: line[66:]))
        self.assertNotIn("  SHA256SUMS", checksums)
        for line in checksums.splitlines():
            expected, filename = line.split("  ", 1)
            self.assertEqual(expected, BUILD.sha(build / "delivery" / filename))
        # Retry in the exact same owned build to prove no timestamps/random IDs
        # are inserted into the metadata. Remove only just-inspected owned data.
        BUILD.inspect_delivery(build / "delivery")
        shutil.rmtree(build / "delivery")
        (build / "delivery-record.json").unlink()
        packages = []
        for architecture in ("arm64", "amd64"):
            package = build / "candidates" / (architecture + ".fpk")
            packages.append({"architecture": architecture, "package": str(package), "sha256": BUILD.sha(package), "ok": True,
                             "signing": "unsigned-local-debug", "source": {"sha256": BUILD.sha(build / "source/source.zip"), "version": "0.2.0", "buildId": build.name}})
        BUILD.deliver(build, packages, "0.2.0")
        self.assertEqual(manifest_bytes, (build / "delivery" / BUILD.DELIVERY_MANIFEST).read_text())
        self.assertEqual(checksums, (build / "delivery/SHA256SUMS").read_text())

    def test_signed_fixture_does_not_claim_device_or_release_ready(self):
        build, _, _ = self.staged(signing="official-fnpack-signed")
        manifest = json.loads((build / "delivery" / BUILD.DELIVERY_MANIFEST).read_text())
        self.assertTrue(manifest["signed"])
        self.assertTrue(manifest["packageReady"])
        self.assertFalse(manifest["releaseReady"])
        self.assertEqual(manifest["deviceValidation"], "not performed")
        self.assertIn("仅代表安装包签名", (build / "delivery" / BUILD.DELIVERY_INSTRUCTIONS).read_text())

    def test_fixture_cleanup_refuses_wrong_owner_before_delete(self):
        with self.assertRaisesRegex(ValueError, "owner differs"):
            cleanup_owned_fixture(self.root, "wrong token")
        self.assertTrue(self.root.exists())

    def test_cli_default_grouping_legacy_tool_path_and_no_deliver_scope(self):
        # Reading implementation text is sufficient: do not invoke main or tools.
        text = (PROJECT / "scripts/build.py").read_text()
        self.assertIn('default=ROOT / "开发存档/上架发布/构建"', text)
        self.assertIn('ROOT / "build/20261121-core-01/toolchain/fnpack"', text)
        self.assertIn('PINNED_PUBLISH_FNPACK', text)
        self.assertIn('mode.add_argument("--publish"', text)
        self.assertIn('if not args.no_deliver:\n            report["dist"] = publish_pointer(build)', text)
        self.assertIn('report["releaseReady"] = False  # Signing is not device acceptance', text)


def main():
    global EVIDENCE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, default=PROJECT / "开发存档/上架发布/交付验收" / (datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]))
    args = parser.parse_args()
    evidence = args.evidence.absolute()
    approved = PROJECT / "开发存档/上架发布/交付验收"
    if ".." in evidence.parts or not evidence.is_relative_to(approved) or evidence == approved:
        parser.error("Evidence must be a new directory under project 开发存档/上架发布/交付验收")
    current = PROJECT
    for part in evidence.relative_to(PROJECT).parts:
        current = current / part
        if current.is_symlink():
            parser.error("Evidence paths must not contain symlinks")
    evidence.mkdir(parents=True, exist_ok=False)
    EVIDENCE = evidence
    (EVIDENCE / "夹具").mkdir()
    (EVIDENCE / "夹具清理记录").mkdir()
    baseline = {"latest": tree_snapshot(PROJECT / "最新安装包"), "dist": os.readlink(PROJECT / "dist"),
                "distInode": (PROJECT / "dist").lstat().st_ino}
    with (EVIDENCE / "交付回归.log").open("x") as log:
        result = unittest.TextTestRunner(stream=log, verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(DeliveryTests))
    unchanged = baseline == {"latest": tree_snapshot(PROJECT / "最新安装包"), "dist": os.readlink(PROJECT / "dist"),
                             "distInode": (PROJECT / "dist").lstat().st_ino}
    report = {"owner": OWNER, "ok": result.wasSuccessful() and unchanged, "tests": result.testsRun,
              "failures": len(result.failures), "errors": len(result.errors), "actualLatestAndDistUnchanged": unchanged,
              "signingToolsExecuted": False, "deviceValidation": "not performed", "releaseReady": False,
              "fixtureCleanup": "owner and entries inspected before deletion", "log": "交付回归.log"}
    (EVIDENCE / "交付验收.json").write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))
    print(EVIDENCE)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
