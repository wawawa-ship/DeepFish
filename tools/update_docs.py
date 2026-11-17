# -*- coding: utf-8 -*-
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------- 安装说明 ----------
p = os.path.join(ROOT, "dist", "安装说明.txt")
s = io.open(p, encoding="utf-8").read()
s = s.replace("DeepFish  v1.5.0", "DeepFish  v1.6.0")
s = s.replace("DeepFish-v1.5.0.apk", "DeepFish-v1.6.0.apk")

cost_block = """【用量与费用】
每条模型回复下面会显示一个金额按钮（例如 ¥0.010），点它展开明细：

  输入          1,234 tokens
  其中缓存命中  1,000
  输出          567 tokens
  联网搜索      1 次
  ─────────────────────
  本次费用      ¥0.010
  高峰时段计价 · 按官方价格估算

计价规则（官方价格，元 / 百万 tokens）：
  deepseek-flash  缓存命中  空闲 0.02 / 高峰 0.04
                  缓存未命中 空闲 1    / 高峰 2
                  输出       空闲 4    / 高峰 8
联网搜索与网页抓取：每次 0.005 元（5 元 / 1000 次）
高峰时段：北京时间周一至周五 9:00-12:00、14:00-18:00（法定节假日除外）

注意：金额是按接口返回的 usage 估算的，不含朗读（TTS）费用，
朗读单独按字符计费（约 3 元 / 万字符，限时 1.5 元）。

"""

if "【用量与费用】" not in s:
    s = s.replace("【数据备份】", cost_block + "【数据备份】")

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("install txt:", "v1.6.0" in s, "用量与费用" in s)

# ---------- README ----------
p2 = os.path.join(ROOT, "README.md")
s2 = io.open(p2, encoding="utf-8").read()
s2 = s2.replace("DeepFish-v1.5.0.apk", "DeepFish-v1.6.0.apk")
s2 = s2.replace("版本 1.5.0", "版本 1.6.0")
s2 = s2.replace(
    "- **1.5.0**：导出包导入改为**可勾选**",
    "- **1.6.0**：新增用量与费用显示——每条回复下方显示本次消耗的人民币金额，\n"
    "  点击展开输入/输出/缓存命中/搜索次数明细；按官方分时段价格估算。\n"
    "  消息操作栏改为纯图标（保留 aria-label），为金额按钮腾出空间。\n"
    "- **1.5.0**：导出包导入改为**可勾选**",
)
io.open(p2, "w", encoding="utf-8", newline="\n").write(s2)
print("README:", "v1.6.0" in s2)
