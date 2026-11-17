# -*- coding: utf-8 -*-
"""生成 Android 资源：启动器图标、自适应图标前景、启动屏 logo"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")
MASTER = Image.open(os.path.join(ROOT, "assets", "avatar-square.png")).convert("RGB")

DENS = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
FG_RATIO = 0.74  # 自适应图标前景占比：太小脸会缩水，太大会被圆形遮罩切到


def rounded(img, ratio=0.22):
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=int(min(w, h) * ratio), fill=255)
    out = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    out.paste(img.convert("RGBA"), (0, 0), mask)
    return out


def circle(img):
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, w - 1, h - 1], fill=255)
    out = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    out.paste(img.convert("RGBA"), (0, 0), mask)
    return out


for dens, sc in DENS.items():
    d = os.path.join(RES, "mipmap-" + dens)
    os.makedirs(d, exist_ok=True)

    s = int(48 * sc)
    MASTER.resize((s, s), Image.LANCZOS).save(os.path.join(d, "ic_launcher.png"), optimize=True)

    circle(MASTER.resize((s, s), Image.LANCZOS)).save(
        os.path.join(d, "ic_launcher_round.png"), optimize=True)

    fs = int(108 * sc)
    fg = Image.new("RGBA", (fs, fs), (0, 0, 0, 0))
    inner = int(fs * FG_RATIO)
    pad = (fs - inner) // 2
    fg.paste(MASTER.resize((inner, inner), Image.LANCZOS), (pad, pad))
    fg.save(os.path.join(d, "ic_launcher_foreground.png"), optimize=True)

logo = rounded(MASTER.resize((512, 512), Image.LANCZOS), 0.22)
os.makedirs(os.path.join(RES, "drawable-nodpi"), exist_ok=True)
logo.save(os.path.join(RES, "drawable-nodpi", "splash_logo.png"), optimize=True)

print("android icons done")
