#!/usr/bin/env python3
"""Verify approved original brand bytes, real PNG alpha, and final fnOS references."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
APPROVED = {
    "icon-original.png": "4306d36c91cae79a34d87f6afc5d3ed118908e58fbd2004d7aab2c68a2956113",
    "logo-original.png": "e9daf753981335d8a9c8362b46307c3c90a6fe6795544ac1e64568717788050a",
    "icon_256.png": "5e05e436d4a4f8671648ce1a005964120edf6b1ffc8c8878e4b389394c7633e2",
    "icon_512.png": "5f92aff0d9bd7fcba758d26112e007280b9813cbc248507cfbf4f886e90a5b47",
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def png(data):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Not a PNG")
    pos, compressed, ended = 8, bytearray(), False
    dimensions = None
    while pos + 12 <= len(data):
        length = struct.unpack_from(">I", data, pos)[0]
        kind = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        if pos + 12 + length > len(data) or zlib.crc32(kind + chunk) & 0xFFFFFFFF != struct.unpack_from(">I", data, pos + 8 + length)[0]:
            raise ValueError("Invalid PNG chunk or CRC")
        if kind == b"IHDR":
            dimensions = struct.unpack(">IIBBBBB", chunk)
        elif kind == b"IDAT":
            compressed.extend(chunk)
        elif kind == b"IEND":
            ended = True
            if pos + 12 != len(data):
                raise ValueError("Trailing PNG bytes")
            break
        pos += length + 12
    if not ended or not compressed or dimensions is None:
        raise ValueError("Incomplete PNG")
    width, height, depth, color, compression, filtering, interlace = dimensions
    if width * height > 16_000_000 or (depth, color, compression, filtering, interlace) != (8, 6, 0, 0, 0):
        raise ValueError("Expected bounded 8-bit RGBA PNG")
    raw = zlib.decompress(compressed)
    stride = width * 4
    if len(raw) != (stride + 1) * height:
        raise ValueError("Invalid PNG scanline size")
    previous = bytearray(stride)
    alpha_min, alpha_max = 255, 0
    for row in range(height):
        offset = row * (stride + 1)
        mode = raw[offset]
        current = bytearray(raw[offset + 1:offset + 1 + stride])
        if mode > 4:
            raise ValueError("Invalid PNG filter")
        for i in range(stride):
            a = current[i - 4] if i >= 4 else 0
            b = previous[i]
            c = previous[i - 4] if i >= 4 else 0
            if mode == 1:
                predictor = a
            elif mode == 2:
                predictor = b
            elif mode == 3:
                predictor = (a + b) // 2
            elif mode == 4:
                p = a + b - c
                distances = abs(p - a), abs(p - b), abs(p - c)
                predictor = (a, b, c)[distances.index(min(distances))]
            else:
                predictor = 0
            current[i] = (current[i] + predictor) & 255
        alpha_min = min(alpha_min, min(current[3::4]))
        alpha_max = max(alpha_max, max(current[3::4]))
        previous = current
    return {"width": width, "height": height, "alphaMin": alpha_min, "alphaMax": alpha_max, "sha256": digest(data)}


def check(stage=None):
    stage = Path(stage) if stage else ROOT / "packaging/fnos"
    report = {}
    for name, expected in APPROVED.items():
        path = ROOT / "assets/brand" / name
        if digest(path.read_bytes()) != expected:
            raise ValueError(f"Approved brand bytes changed: {name}")
    for name, size in (("ICON.PNG", 256), ("ICON_256.PNG", 256), ("ICON_512.PNG", 512),
                       ("app/ui/images/icon_256.png", 256), ("app/ui/images/icon_512.png", 512)):
        data = (stage / name).read_bytes()
        image = png(data)
        if (image["width"], image["height"]) != (size, size) or image["alphaMin"] != 0 or image["alphaMax"] != 255:
            raise ValueError(f"Wrong dimensions or lost alpha: {name}")
        if digest(data) != APPROVED[f"icon_{size}.png"]:
            raise ValueError(f"Icon differs from approved full-original derivative: {name}")
        report[name] = image
    for name, size in (("icon_256.png", 256), ("icon_512.png", 512)):
        data = (ROOT / "web/public/brand" / name).read_bytes()
        image = png(data)
        if (image["width"], image["height"]) != (size, size) or image["alphaMin"] != 0 or image["alphaMax"] != 255:
            raise ValueError(f"Wrong dimensions or lost alpha: web/public/brand/{name}")
        if digest(data) != APPROVED[name]:
            raise ValueError(f"Icon differs from approved full-original derivative: web/public/brand/{name}")
        report[f"web/public/brand/{name}"] = image
    ui = json.loads((stage / "app/ui/config").read_text())
    brand = json.loads((ROOT / "branding/brand.json").read_text())
    entries = ui.get(".url", {})
    entry = entries.get("xiaoniubawang.Application", {})
    if set(entries) != {"xiaoniubawang.Application"} or entry.get("icon") != "images/icon_{0}.png" or entry.get("title") != brand["name"]:
        raise ValueError("UI does not reference the approved 256/512 icons and brand title")
    if (stage / "app/ui/brand/logo.png").read_bytes() != (ROOT / "assets/brand/logo-original.png").read_bytes():
        raise ValueError("Desktop logo differs from approved original")
    print(json.dumps({"ok": True, "icons": report}, ensure_ascii=False, indent=2))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", type=Path)
    args = parser.parse_args()
    check(args.stage)
