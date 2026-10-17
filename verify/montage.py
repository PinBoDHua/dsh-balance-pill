"""Build a labelled contact sheet of the harness row crops.

Usage: python montage.py out/pill-v11.json out/montage-v11.png
Each row shows the tail of the composer status row (stats → context ring → balance pill),
cropped from that variant's screenshot using the geometry the harness reported.
If a variant carries a `stale` capture, the stale frame is appended right below it.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

summary_path, out_path = sys.argv[1], sys.argv[2]
with open(summary_path, encoding="utf-8") as handle:
    summary = json.load(handle)


def label_font(size=14):
    """取一个能画中文的字体；找不到就退回 PIL 默认字体（英文标签仍然可读）。"""
    for candidate in (
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\simsun.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    ):
        if os.path.exists(candidate):
            try:
                return ImageFont.truetype(candidate, size)
            except OSError:
                continue
    return ImageFont.load_default()


FONT = label_font()

SCALE = 2.0
PAD = 10
LABEL_H = 26
TAIL = 520  # width of the row tail to keep, ending at the pill's right edge

# 变体名 → 给读者看的中文标签。
LABELS = {
    "default": "默认（趋势 + 本轮会话消耗 + 可用合计）",
    "no-trend": "关掉「趋势」与「会话消耗」两项",
    "compact": "紧凑模式（不带币种符号）",
    "bonus-only": "口径 = 仅赠金余额",
    "usd-preferred": "币种偏好 = 美元（无美元钱包则回落）",
    "red": "阈值抬高：红色档",
    "dark": "深色主题",
    "stale-probe": "读取失败：保留旧数字并标成过期",
    "low": "红色档（余额不足）",
    "warn": "橙色档（余额偏低）",
    "ok": "绿色档（余额充足）",
    "dark-ok": "深色主题 · 绿色档",
}


def crop_row(image, rect):
    box = (
        max(0, rect["x"] + rect["w"] - TAIL),
        max(0, rect["y"] - PAD),
        rect["x"] + rect["w"] + PAD,
        rect["y"] + rect["h"] + PAD,
    )
    piece = image.crop(box)
    return piece.resize((int(piece.width * SCALE), int(piece.height * SCALE)), Image.LANCZOS)


tiles = []
for result in summary["results"]:
    inspect = result["inspect"]
    pill = inspect.get("pill")
    if pill is None:
        continue
    name = result["variant"]["name"]
    attrs = inspect["pillAttrs"]
    label = (
        f"{LABELS.get(name, name)}   [{attrs['level']}/{attrs['status']}]  "
        f"{inspect['trigger']['text']}  {inspect['trigger']['color']}"
    )
    tiles.append((label, crop_row(Image.open(result["screenshot"]).convert("RGB"), pill["rect"])))

    stale_state = result.get("stale")
    if stale_state is not None:
        stale_inspect = stale_state["inspect"]
        tiles.append(
            (
                f"  ↳ 读取失败后  [status={stale_inspect['pillAttrs']['status']}, "
                f"opacity={stale_inspect['trigger']['opacity']}]  数字不变",
                crop_row(
                    Image.open(result["screenshot"].replace(".png", "-stale.png")).convert("RGB"),
                    stale_inspect["pill"]["rect"],
                ),
            )
        )

# 面板截图单独拼一张：v1.2 新增的趋势图与会话消耗都在面板里。
panel_tiles = []
for result in summary["results"]:
    panel = result.get("panel") or {}
    if not panel.get("panelFound"):
        continue
    name = result["variant"]["name"]
    shot = result["screenshot"].replace(".png", "-panel.png")
    if not os.path.exists(shot):
        continue
    rect = panel["rect"]
    pad = 12
    box = (max(0, rect["x"] - pad), max(0, rect["y"] - pad), rect["x"] + rect["w"] + pad, rect["y"] + rect["h"] + pad)
    image = Image.open(shot).convert("RGB")
    piece = image.crop(box)
    piece = piece.resize((int(piece.width * 2.0), int(piece.height * 2.0)), Image.LANCZOS)
    panel_tiles.append((LABELS.get(name, name), piece))

if panel_tiles:
    width = max(tile.width for _, tile in panel_tiles) + PAD * 2
    height = sum(tile.height + LABEL_H + PAD for _, tile in panel_tiles) + PAD
    sheet = Image.new("RGB", (width, height), (245, 247, 250))
    draw = ImageDraw.Draw(sheet)
    y = PAD
    for label, tile in panel_tiles:
        draw.text((PAD, y + 6), label, fill=(30, 41, 59), font=FONT)
        y += LABEL_H
        sheet.paste(tile, (PAD, y))
        draw.rectangle([PAD - 1, y - 1, PAD + tile.width, y + tile.height], outline=(203, 213, 225))
        y += tile.height + PAD
    panels_path = out_path.replace(".png", "-panels.png")
    sheet.save(panels_path)
    print(f"{panels_path} {sheet.width}x{sheet.height} tiles={len(panel_tiles)}")

width = max(tile.width for _, tile in tiles) + PAD * 2
height = sum(tile.height + LABEL_H + PAD for _, tile in tiles) + PAD
sheet = Image.new("RGB", (width, height), (245, 247, 250))
draw = ImageDraw.Draw(sheet)
y = PAD
for label, tile in tiles:
    draw.text((PAD, y + 6), label, fill=(30, 41, 59), font=FONT)
    y += LABEL_H
    sheet.paste(tile, (PAD, y))
    draw.rectangle([PAD - 1, y - 1, PAD + tile.width, y + tile.height], outline=(203, 213, 225))
    y += tile.height + PAD

sheet.save(out_path)
print(f"{out_path} {sheet.width}x{sheet.height} tiles={len(tiles)}")
