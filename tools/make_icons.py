# -*- coding: utf-8 -*-
"""从用户提供的正方形原图生成全套图标（只缩放，不重新构图）"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "avatar-square.png")
OUT = os.path.join(ROOT, "www", "icons")
os.makedirs(OUT, exist_ok=True)

src = Image.open(SRC).convert("RGB")


def save(img, name, size):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
    print("  ->", name, size)


# PWA / 桌面图标：直接用整张方图
save(src, "icon-512.png", 512)
save(src, "icon-192.png", 192)
save(src, "icon-384.png", 384)
save(src, "apple-touch-icon-180.png", 180)
save(src, "apple-touch-icon-152.png", 152)
save(src, "apple-touch-icon-120.png", 120)
save(src, "favicon-32.png", 32)
save(src, "favicon-16.png", 16)

# maskable：内容缩到 80%，四周白底延展（避免被系统裁到脸）
S = 512
inner = int(S * 0.80)
pad = (S - inner) // 2
m = Image.new("RGB", (S, S), (255, 255, 255))
m.paste(src.resize((inner, inner), Image.LANCZOS), (pad, pad))
m.save(os.path.join(OUT, "icon-maskable-512.png"), optimize=True)
print("  -> icon-maskable-512.png")

# 主页/对话里用的头像小图
save(src, "avatar-256.png", 256)

# 方形缩略图，供 Android 自适应前景使用
src.resize((432, 432), Image.LANCZOS).save(os.path.join(OUT, "ic_launcher_foreground.png"), optimize=True)

# 背景：取图像边缘的白色
bg = Image.new("RGB", (432, 432), (255, 255, 255))
bg.save(os.path.join(OUT, "ic_launcher_background.png"))
print("done")
