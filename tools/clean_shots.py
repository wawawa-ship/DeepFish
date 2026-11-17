# -*- coding: utf-8 -*-
"""开源前整理：只保留 README 引用到的截图，避免仓库里堆测试图。"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "assets", "shots")

readme = io.open(os.path.join(ROOT, "README.md"), encoding="utf-8").read()
readme_en = io.open(os.path.join(ROOT, "README.en.md"), encoding="utf-8").read()

used = set(re.findall(r"assets/shots/([A-Za-z0-9_\-\.]+)", readme + readme_en))
print("README 引用的截图:", sorted(used))

removed = 0
for name in os.listdir(SHOTS):
    if not name.lower().endswith(".png"):
        continue
    if name in used:
        continue
    os.remove(os.path.join(SHOTS, name))
    removed += 1

print("删除未引用截图:", removed)
print("剩余:", sorted(os.listdir(SHOTS)))
