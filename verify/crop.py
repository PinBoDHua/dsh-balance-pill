"""Crop a region from a screenshot for close inspection.

Usage: python crop.py <png> <out.png> <x> <y> <w> <h> [scale]
The region is read from the harness JSON when --from-json is given instead.
"""
import json
import sys

from PIL import Image

args = sys.argv[1:]
if args and args[0] == "--from-json":
    with open(args[1], encoding="utf-8") as handle:
        summary = json.load(handle)
    source, out = args[2], args[3]
    pad = int(args[4]) if len(args) > 4 else 8
    scale = float(args[5]) if len(args) > 5 else 3.0
    rect = summary["inspect"]["trigger"]["rect"]
    box = (
        max(0, rect["x"] - 200 - pad),
        max(0, rect["y"] - pad),
        rect["x"] + rect["w"] + pad,
        rect["y"] + rect["h"] + pad,
    )
else:
    source, out = args[0], args[1]
    box = tuple(int(value) for value in args[2:6])
    scale = float(args[6]) if len(args) > 6 else 3.0

image = Image.open(source).convert("RGB")
crop = image.crop(box)
if scale != 1:
    crop = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS)
crop.save(out)
print(f"{source} {box} -> {out} {crop.width}x{crop.height}")
