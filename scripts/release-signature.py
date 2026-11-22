#!/usr/bin/env python3
"""Opt-in verification of the observed pinned fnpack 1.3.3 signing contract.

This is not a claim that the application store requires signing. An independently
selected existing developer public certificate is the trust anchor, never the
certificate embedded by an arbitrary package. No private keys/default stores are
read and no package/stage bytes are changed.
"""
from __future__ import annotations

import base64
import binascii
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess

METADATA_FILES = frozenset({"META-INF/checksums.json", "META-INF/signature.json", "META-INF/developer.crt"})
SIGNING_PREFIX = b"FNPACK-SIGNATURE-V1\n"
MAX_METADATA = 10 * 1024 * 1024
CONTRACT_TOOL_SHA256 = "2f933c55ec1bdd1f18aa175ce916cb571ae021f18a6d137edfdd7e8333877648"


def fail(code, detail):
    raise ValueError(f"{code}: {detail}")


def strict_json(data, label):
    if len(data) > MAX_METADATA:
        fail("RELEASE_SIGNATURE_INVALID", f"oversized {label}")
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                fail("RELEASE_SIGNATURE_INVALID", f"duplicate JSON field in {label}")
            result[key] = value
        return result
    try:
        value = json.loads(data, object_pairs_hook=pairs)
    except (UnicodeError, json.JSONDecodeError) as error:
        fail("RELEASE_SIGNATURE_INVALID", f"malformed {label}: {error}")
    if not isinstance(value, dict):
        fail("RELEASE_SIGNATURE_INVALID", f"{label} must be an object")
    return value


def exact_fields(value, expected, label):
    if set(value) != set(expected):
        fail("RELEASE_SIGNATURE_UNVERIFIABLE", f"unrecognized {label} fields; observed fnpack 1.3.3 contract only")


def openssl(arguments, data, pass_fds=()):
    executable = shutil.which("openssl")
    if not executable:
        fail("RELEASE_SIGNATURE_UNVERIFIABLE", "OpenSSL is required for certificate/RSA verification")
    try:
        result = subprocess.run([executable, *arguments], input=data, capture_output=True, timeout=15, pass_fds=pass_fds)
    except (OSError, subprocess.TimeoutExpired):
        fail("RELEASE_SIGNATURE_UNVERIFIABLE", "OpenSSL verification unavailable")
    if result.returncode:
        fail("RELEASE_SIGNATURE_INVALID", "OpenSSL rejected certificate or RSA signature")
    return result.stdout


def public_certificate(data):
    # A chain/schema not established by our actual single-leaf fixture must not
    # silently become a new trust policy. Accept PEM leaf or DER leaf only.
    if len(data) > MAX_METADATA:
        fail("RELEASE_CERTIFICATE_INVALID", "oversized public certificate")
    if b"PRIVATE KEY" in data:
        fail("RELEASE_CERTIFICATE_INVALID", "public certificate input must not contain a private key")
    if b"-----BEGIN" in data:
        match = re.fullmatch(rb"\s*-----BEGIN CERTIFICATE-----\s+([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----\s*", data)
        if not match:
            fail("RELEASE_CERTIFICATE_UNVERIFIABLE", "only the observed single-leaf PEM/DER certificate contract is supported")
        try:
            der = base64.b64decode(re.sub(rb"\s", b"", match[1]), validate=True)
        except binascii.Error:
            fail("RELEASE_CERTIFICATE_INVALID", "invalid PEM certificate")
    else:
        der = data
    parsed = openssl(["x509", "-inform", "DER", "-outform", "DER"], der)
    if parsed != der:
        fail("RELEASE_CERTIFICATE_INVALID", "noncanonical or trailing certificate bytes")
    return der


def certificate_policy(der):
    dates = openssl(["x509", "-inform", "DER", "-noout", "-startdate", "-enddate"], der).decode("ascii")
    try:
        values = dict(line.split("=", 1) for line in dates.strip().splitlines())
        start = datetime.strptime(values["notBefore"], "%b %d %H:%M:%S %Y GMT").replace(tzinfo=timezone.utc)
        end = datetime.strptime(values["notAfter"], "%b %d %H:%M:%S %Y GMT").replace(tzinfo=timezone.utc)
    except (ValueError, KeyError):
        fail("RELEASE_CERTIFICATE_UNVERIFIABLE", "unrecognized certificate validity format")
    if not start <= datetime.now(timezone.utc) <= end:
        fail("RELEASE_CERTIFICATE_INVALID", "developer public certificate is not currently valid")
    extensions = openssl(["x509", "-inform", "DER", "-noout", "-ext", "extendedKeyUsage,keyUsage,basicConstraints"], der).decode("ascii")
    if "Code Signing" not in extensions or "CA:FALSE" not in extensions or "Digital Signature" not in extensions:
        fail("RELEASE_CERTIFICATE_INVALID", "observed signing contract requires a non-CA code-signing leaf with digitalSignature")
    return {"notBefore": start.isoformat(), "notAfter": end.isoformat()}


def verify_rsa(der, signature, signed_input):
    public_key = openssl(["x509", "-inform", "DER", "-pubkey", "-noout"], der)
    # Public-key-only pipe: verification needs no temporary files, private keys,
    # /home credentials or archive extraction. POSIX is the supported build host.
    if os.name != "posix" or len(public_key) > 4096:
        fail("RELEASE_SIGNATURE_UNVERIFIABLE", "POSIX public-key pipe / supported RSA key size required")
    reader, writer = os.pipe()
    try:
        os.write(writer, public_key)
        os.close(writer)
        writer = None
        recovered = openssl(["pkeyutl", "-verifyrecover", "-pubin", "-inkey", f"/dev/fd/{reader}", "-pkeyopt", "rsa_padding_mode:pkcs1"], signature, (reader,))
    finally:
        os.close(reader)
        if writer is not None:
            os.close(writer)
    expected = bytes.fromhex("3031300d060960864801650304020105000420") + hashlib.sha256(signed_input).digest()
    if not hmac.compare_digest(recovered, expected):
        fail("RELEASE_SIGNATURE_INVALID", "RSA-SHA256 signature does not authenticate the literal checksum bytes / certificate fingerprint")


def verify_signature_metadata(archive, members, read_member, expected_certificate=None):
    """Verify signing independently of the project's stricter outer512 policy.

    This lower-level function is useful for real official fixtures that cannot
    pass outer512. It does not label a package release-ready.
    """
    if not METADATA_FILES.issubset(members):
        if "signature.json" in members or "checksums.json" in members:
            fail("RELEASE_SIGNATURE_UNVERIFIABLE", "unrecognized root signing metadata; actual fnpack 1.3.3 uses META-INF")
        fail("RELEASE_SIGNATURE_MISSING", "official META-INF signature/checksums/developer certificate missing")
    metadata = {name for name in members if name.startswith("META-INF/")}
    if metadata != METADATA_FILES:
        fail("RELEASE_SIGNATURE_UNVERIFIABLE", "unknown META-INF files; refusing unestablished metadata")
    if expected_certificate is None:
        fail("RELEASE_EXPECTED_CERTIFICATE_REQUIRED", "opt-in signing verification needs an independently selected existing developer public certificate; embedded identity is not a trust anchor")
    expected_path = Path(expected_certificate)
    if not expected_path.is_file():
        fail("RELEASE_EXPECTED_CERTIFICATE_MISSING", "explicit expected public certificate is unavailable; no default/home lookup performed")
    if expected_path.stat().st_size > MAX_METADATA:
        fail("RELEASE_CERTIFICATE_INVALID", "oversized expected public certificate")
    expected_der = public_certificate(expected_path.read_bytes())
    embedded_der = public_certificate(read_member(archive, members, "META-INF/developer.crt"))
    fingerprint = hashlib.sha256(expected_der).hexdigest()
    if not hmac.compare_digest(embedded_der, expected_der):
        fail("RELEASE_CERTIFICATE_MISMATCH", "embedded leaf is not the independently expected developer certificate")
    signature_json = strict_json(read_member(archive, members, "META-INF/signature.json"), "signature.json")
    exact_fields(signature_json, {"version", "algorithm", "certificate_sha256", "signature"}, "signature.json")
    if type(signature_json["version"]) is not int or signature_json["version"] != 1 or signature_json["algorithm"] != "RSA-SHA256":
        fail("RELEASE_SIGNATURE_UNVERIFIABLE", "unsupported signature version/algorithm")
    if signature_json["certificate_sha256"] != fingerprint:
        fail("RELEASE_CERTIFICATE_MISMATCH", "signature certificate_sha256 differs from expected certificate DER fingerprint")
    try:
        encoded = signature_json["signature"]
        if not isinstance(encoded, str) or len(encoded) > 4096:
            raise ValueError()
        signature = base64.b64decode(encoded, validate=True)
        if not signature or base64.b64encode(signature).decode() != encoded:
            raise ValueError()
    except (ValueError, binascii.Error):
        fail("RELEASE_SIGNATURE_INVALID", "invalid base64 signature")
    checksums_bytes = read_member(archive, members, "META-INF/checksums.json")
    checksums = strict_json(checksums_bytes, "checksums.json")
    exact_fields(checksums, {"version", "hash", "files"}, "checksums.json")
    if type(checksums["version"]) is not int or checksums["version"] != 1 or checksums["hash"] != "sha256" or not isinstance(checksums["files"], list):
        fail("RELEASE_SIGNATURE_UNVERIFIABLE", "unsupported checksum contract")
    listed = {}
    for item in checksums["files"]:
        if not isinstance(item, dict):
            fail("RELEASE_CHECKSUM_INVALID", "checksum file record must be an object")
        exact_fields(item, {"path", "sha256"}, "checksum file record")
        name, digest = item["path"], item["sha256"]
        if not isinstance(name, str) or not name or "\\" in name or PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts or PurePosixPath(name).as_posix() != name or name.startswith("META-INF/") or name in listed:
            fail("RELEASE_CHECKSUM_INVALID", "unsafe/duplicate signing checksum path")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            fail("RELEASE_CHECKSUM_INVALID", "invalid SHA256 checksum")
        listed[name] = digest
    if set(listed) != set(members) - METADATA_FILES:
        fail("RELEASE_CHECKSUM_INVENTORY", "checksums must cover exactly every non-metadata outer regular file")
    for name, digest in listed.items():
        if hashlib.sha256(read_member(archive, members, name)).hexdigest() != digest:
            fail("RELEASE_CHECKSUM_MISMATCH", f"signed outer file differs: {name}")
    validity = certificate_policy(expected_der)
    verify_rsa(expected_der, signature, SIGNING_PREFIX + fingerprint.encode("ascii") + b"\n" + checksums_bytes)
    return {"verified": True, "contract": "observed-official-fnpack-1.3.3-v1", "contractToolSHA256": CONTRACT_TOOL_SHA256,
            "algorithm": "RSA-SHA256 / PKCS1-v1_5", "certificateSHA256": fingerprint, "certificateFingerprintEncoding": "DER",
            "trust": "independently-supplied-expected-public-certificate", "certificateValidity": validity,
            "checksumFiles": len(listed), "checksumsSHA256": hashlib.sha256(checksums_bytes).hexdigest(),
            "signatureInput": "FNPACK-SIGNATURE-V1 LF + certificate DER SHA256 lowercase hex + LF + literal checksums.json bytes",
            "metadataFiles": sorted(METADATA_FILES), "storeSigningRequirement": "not established by this verification"}
