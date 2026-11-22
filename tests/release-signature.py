#!/usr/bin/env python3
"""Signing gates: actual official fixture + isolated synthetic adversarial tests.

All test identities/outputs are explicitly disposable, never publisher/release.
Run with --official-fixture from trusted fnpack build and matching --test-cert /
--test-key (only OpenSSL receives the disposable key path; never printed/read).
"""
from __future__ import annotations
import argparse
import base64
import copy
import hashlib
import io
import json
from pathlib import Path
import runpy
import subprocess
import tarfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = runpy.run_path(str(ROOT / "scripts/check-package.py"))
SIGNATURE = PACKAGE["SIGNATURE"]


class SigningTests(unittest.TestCase):
    def setUp(self):
        self.area = self.evidence / self._testMethodName
        self.area.mkdir()
        self.stage = self.area / "stage"
        self.stage.mkdir()
        (self.stage / "ICON_512.PNG").write_bytes(self.icon)

    def original(self):
        with tarfile.open(self.official) as t:
            return {m.name: t.extractfile(m).read() for m in t.getmembers() if m.isfile()}

    def write_package(self, files, name="fixture.fpk"):
        path = self.area / name
        with tarfile.open(path, "w:gz") as t:
            for filename, data in files.items():
                member = tarfile.TarInfo(filename)
                member.size, member.mode = len(data), 0o755 if filename.startswith("cmd/") else 0o644
                t.addfile(member, io.BytesIO(data))
        return path

    def sign_test_files(self, files):
        files = copy.deepcopy(files)
        entries = [{"path": n, "sha256": hashlib.sha256(d).hexdigest()} for n, d in sorted(files.items()) if n not in SIGNATURE["METADATA_FILES"]]
        data = json.dumps({"version": 1, "hash": "sha256", "files": entries}, separators=(",", ":")).encode()
        files["META-INF/checksums.json"] = data
        sig = json.loads(files["META-INF/signature.json"])
        signed = SIGNATURE["SIGNING_PREFIX"] + sig["certificate_sha256"].encode() + b"\n" + data
        result = subprocess.run(["openssl", "dgst", "-sha256", "-sign", str(self.key)], input=signed, capture_output=True, check=True)
        sig["signature"] = base64.b64encode(result.stdout).decode()
        files["META-INF/signature.json"] = json.dumps(sig, separators=(",", ":")).encode()
        return files

    def with512(self):
        files = self.original()
        files["ICON_512.PNG"] = self.icon
        return self.sign_test_files(files)

    def verify_metadata(self, path, cert=None):
        with tarfile.open(path) as t:
            return SIGNATURE["verify_signature_metadata"](t, PACKAGE["inventory"](t), PACKAGE["read"], cert or self.cert)

    def test_actual_official_fixture_signature(self):
        before = self.official.read_bytes()
        result = self.verify_metadata(self.official)
        self.assertTrue(result["verified"])
        self.assertEqual(result["certificateFingerprintEncoding"], "DER")
        self.assertEqual(self.official.read_bytes(), before)
        (self.area / "actual-verification.json").write_text(json.dumps(result, indent=2) + "\n")

    def test_actual_official512_conflict_never_mutates(self):
        before = self.official.read_bytes()
        with self.assertRaisesRegex(ValueError, "RELEASE_ICON512_MISSING"):
            PACKAGE["release_signature"](self.official, self.stage, self.cert)
        self.assertEqual(self.official.read_bytes(), before)

    def test_synthetic_signed512_contract_pass_not_official_release(self):
        path = self.write_package(self.with512())
        before = path.read_bytes()
        result = PACKAGE["release_signature"](path, self.stage, self.cert)
        self.assertTrue(result["verified"])
        self.assertEqual(path.read_bytes(), before)

    def test_expected_certificate_absent_fails_closed(self):
        path = self.write_package(self.with512())
        with self.assertRaisesRegex(ValueError, "RELEASE_EXPECTED_CERTIFICATE_REQUIRED"):
            PACKAGE["release_signature"](path, self.stage)
        with self.assertRaisesRegex(ValueError, "RELEASE_EXPECTED_CERTIFICATE_MISSING"):
            PACKAGE["release_signature"](path, self.stage, self.area / "nonexistent.crt")

    def test_unsigned_and_old_guessed_metadata_rejected(self):
        for extras in ({}, {"signature.json": b"{}", "checksums.json": b"{}"}):
            files = {n: d for n, d in self.with512().items() if n not in SIGNATURE["METADATA_FILES"]}
            files.update(extras)
            code = "RELEASE_SIGNATURE_UNVERIFIABLE" if extras else "RELEASE_SIGNATURE_MISSING"
            with self.assertRaisesRegex(ValueError, code):
                PACKAGE["release_signature"](self.write_package(files, "unsigned" + str(len(extras)) + ".fpk"), self.stage, self.cert)

    def test_payload_tamper(self):
        files = self.with512()
        files["app.tgz"] += b"tamper"
        with self.assertRaisesRegex(ValueError, "RELEASE_CHECKSUM_MISMATCH"):
            PACKAGE["release_signature"](self.write_package(files), self.stage, self.cert)

    def test_checksum_bytes_not_canonicalized(self):
        files = self.with512()
        files["META-INF/checksums.json"] += b"\n"
        with self.assertRaisesRegex(ValueError, "RELEASE_SIGNATURE_INVALID"):
            PACKAGE["release_signature"](self.write_package(files), self.stage, self.cert)

    def test_checksum_semantic_tamper(self):
        files = self.with512()
        obj = json.loads(files["META-INF/checksums.json"])
        obj["files"][0]["sha256"] = "0" * 64
        files["META-INF/checksums.json"] = json.dumps(obj).encode()
        with self.assertRaisesRegex(ValueError, "RELEASE_CHECKSUM_MISMATCH"):
            PACKAGE["release_signature"](self.write_package(files), self.stage, self.cert)

    def test_signature_tamper(self):
        files = self.with512()
        obj = json.loads(files["META-INF/signature.json"])
        sig = bytearray(base64.b64decode(obj["signature"]))
        sig[0] ^= 1
        obj["signature"] = base64.b64encode(sig).decode()
        files["META-INF/signature.json"] = json.dumps(obj).encode()
        with self.assertRaisesRegex(ValueError, "RELEASE_SIGNATURE_INVALID"):
            PACKAGE["release_signature"](self.write_package(files), self.stage, self.cert)

    def test_certificate_substitution_even_same_key(self):
        alternate = self.area / "alternate-public.crt"
        subprocess.run(["openssl", "req", "-new", "-x509", "-key", str(self.key), "-days", "2", "-subj", "/CN=DIFFERENT DISPOSABLE NOT PUBLISHER/O=fnOS", "-addext", "basicConstraints=critical,CA:FALSE", "-addext", "keyUsage=digitalSignature", "-addext", "extendedKeyUsage=codeSigning", "-out", str(alternate)], capture_output=True, check=True)
        files = self.with512()
        files["META-INF/developer.crt"] = alternate.read_bytes()
        with self.assertRaisesRegex(ValueError, "RELEASE_CERTIFICATE_MISMATCH"):
            PACKAGE["release_signature"](self.write_package(files), self.stage, self.cert)

    def test_unsigned_icon_supplement_not_authenticated(self):
        files = self.original()
        files["ICON_512.PNG"] = self.icon
        with self.assertRaisesRegex(ValueError, "RELEASE_CHECKSUM_INVENTORY"):
            PACKAGE["release_signature"](self.write_package(files), self.stage, self.cert)

    def test_changed512_rejected(self):
        files = self.with512()
        files["ICON_512.PNG"] += b"changed"
        with self.assertRaisesRegex(ValueError, "RELEASE_ICON512_CHANGED"):
            PACKAGE["release_signature"](self.write_package(files), self.stage, self.cert)

    def test_unknown_metadata_and_duplicate_json_fail_closed(self):
        files = self.with512()
        files["META-INF/unknown.json"] = b"{}"
        with self.assertRaisesRegex(ValueError, "RELEASE_SIGNATURE_UNVERIFIABLE"):
            PACKAGE["release_signature"](self.write_package(files, "unknown.fpk"), self.stage, self.cert)
        del files["META-INF/unknown.json"]
        files["META-INF/signature.json"] = b'{"version":1,"version":1}'
        with self.assertRaisesRegex(ValueError, "duplicate JSON"):
            PACKAGE["release_signature"](self.write_package(files, "duplicate.fpk"), self.stage, self.cert)

    def test_signed_inventory_and_report_integration(self):
        # Isolate expensive application validation, not signing/inventory/bytes.
        # This regression exercises the old unconditional unsigned report and
        # rejection of authentic META-INF by the exact outer inventory gate.
        files = self.with512()
        files["manifest"] = (ROOT / "packaging/fnos/manifest").read_bytes().replace(b"@PLATFORM@", b"x86")
        app = self.stage / "app"
        app.mkdir()
        (app / "runtime.txt").write_bytes(b"test only payload")
        inner = io.BytesIO()
        with tarfile.open(fileobj=inner, mode="w:gz") as t:
            for name, data in {"runtime.txt": b"test only payload", **{"config/" + n: files["config/" + n] for n in ("privilege", "resource")}}.items():
                m = tarfile.TarInfo(name)
                m.size, m.mode = len(data), 0o644
                t.addfile(m, io.BytesIO(data))
        files["app.tgz"] = inner.getvalue()
        for name, data in files.items():
            if name not in SIGNATURE["METADATA_FILES"] and name != "app.tgz":
                target = self.stage / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
        files = self.sign_test_files(files)
        path = self.write_package(files)
        stage_report = {"support": {"enabled": False}}
        with mock.patch.dict(PACKAGE["check_package"].__globals__, {"check_stage": lambda *args: copy.deepcopy(stage_report), "check_support_archive": lambda *args: None}):
            report = PACKAGE["check_package"](path, self.stage, "amd64", release=True, expected_certificate=self.cert)
            self.assertFalse(report["releaseReady"])
            self.assertEqual(report["signing"], "official-fnpack-signed")
            self.assertTrue(report["signatureVerification"]["verified"])
            self.assertIn("not established", report["storeSigningRequirement"])
            unsigned = {n: d for n, d in files.items() if n not in SIGNATURE["METADATA_FILES"]}
            unsigned_report = PACKAGE["check_package"](self.write_package(unsigned, "unsigned-report.fpk"), self.stage, "amd64")
            self.assertFalse(unsigned_report["releaseReady"])
            self.assertEqual(unsigned_report["signing"], "unsigned-local-debug")
            publish_report = PACKAGE["check_package"](self.write_package(unsigned, "publish-report.fpk"), self.stage, "amd64", publish=True)
            self.assertFalse(publish_report["releaseReady"])
            self.assertEqual(publish_report["signing"], "unsigned-official-package")
            self.assertEqual(publish_report["mode"], "ordinary-publication-candidate")
            self.assertIsNone(publish_report["signatureVerification"])

    def test_official_missing_explicit_test_key_no_default_lookup(self):
        out = self.area / "official-output"
        out.mkdir()
        r = subprocess.run([str(self.fnpack), "build", "-d", str(self.official_stage), "--key", str(self.area / "missing.key"), "--cert", str(self.cert)], cwd=out, capture_output=True, text=True)
        (self.area / "official-missing-key.log").write_text(r.stdout + r.stderr)
        self.assertIn("Packing failed", r.stdout + r.stderr)
        self.assertFalse(list(out.glob("*.fpk")))


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--evidence", type=Path, required=True)
    p.add_argument("--official-fixture", type=Path, required=True)
    p.add_argument("--test-cert", type=Path, required=True)
    p.add_argument("--test-key", type=Path, required=True)
    p.add_argument("--fnpack", type=Path, required=True)
    p.add_argument("--official-stage", type=Path, required=True)
    a = p.parse_args()
    a.evidence.mkdir(parents=True, exist_ok=False)
    SigningTests.evidence = a.evidence
    SigningTests.official, SigningTests.cert, SigningTests.key = a.official_fixture, a.test_cert, a.test_key
    SigningTests.fnpack, SigningTests.official_stage = a.fnpack, a.official_stage
    SigningTests.icon = (ROOT / "packaging/fnos/ICON_512.PNG").read_bytes()
    with (a.evidence / "signing-tests.log").open("x") as log:
        result = unittest.TextTestRunner(stream=log, verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(SigningTests))
    report = {"ok": result.wasSuccessful(), "testsRun": result.testsRun, "failures": len(result.failures), "errors": len(result.errors),
              "officialFixtureSHA256": hashlib.sha256(a.official_fixture.read_bytes()).hexdigest(),
              "identity": "DISPOSABLE TEST ONLY NOT PUBLISHER", "synthetic512Fixtures": "test-only handwritten archives, not official output and never release candidates", "remoteOperations": False,
              "publisherVerified": False, "storeMandatorySigning": "unconfirmed", "defaultCredentialContextChanged": False}
    (a.evidence / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if result.wasSuccessful() else 1)
