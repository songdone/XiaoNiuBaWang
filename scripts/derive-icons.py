#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

source = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()

image = Image.open(source).convert("RGBA")
image.thumbnail((512, 512), Image.Resampling.LANCZOS)
canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
canvas.alpha_composite(image, ((512 - image.width) // 2, (512 - image.height) // 2))

output.mkdir(parents=True, exist_ok=True)
for size in (256, 512):
    target = canvas.resize((size, size), Image.Resampling.LANCZOS)
    target.save(output / f"icon_{size}.png", format="PNG", optimize=False)
