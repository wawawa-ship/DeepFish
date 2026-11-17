# -*- coding: utf-8 -*-
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------- README ----------
p = os.path.join(ROOT, "README.md")
s = io.open(p, encoding="utf-8").read()
s = s.replace("DeepFish-v1.7.1.apk", "DeepFish-v1.8.0.apk")
s = s.replace("版本 1.7.1", "版本 1.8.0")

s = s.replace(
    "- **1.7.1**：",
    "- **1.8.0**：新增「检查更新」——直接查 GitHub Releases 并比较版本；\n"
    "  修复导入超长对话后卡顿：消息列表改为分页渲染（默认 30 条，向上加载更多），\n"
    "  超过 8000 字的消息降级为纯文本渲染，抽屉预览与朗读也做了截断。\n"
    "- **1.7.1**：",
    1,
)

if "### 检查更新" not in s:
    block = """### 检查更新

设置 → 关于 → 「检查更新」，会去 GitHub 查最新的 Release：

- 有新版：弹出提示，点「去下载」复制下载链接（APK 优先，没有则给 Release 页面）
- 已最新：提示当前版本
- 还没发过 Release：提示「作者还没有发布正式版本」

> 作者发布新版本时，记得在 GitHub 上 **Create a release** 并上传 APK，
> 标签用 `v1.8.0` 这种格式。只有打了 Release，「检查更新」才能读到。

"""
    s = s.replace("## 开源协议", block + "## 开源协议", 1)

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("README:", "1.8.0" in s, "检查更新" in s)

# ---------- 安装说明 ----------
p2 = os.path.join(ROOT, "dist", "安装说明.txt")
t = io.open(p2, encoding="utf-8").read()
t = t.replace("DeepFish  v1.7.1", "DeepFish  v1.8.0")
t = t.replace("DeepFish-v1.7.1.apk", "DeepFish-v1.8.0.apk")

extra = """【检查更新】
设置 → 关于 → 「检查更新」，会查询 GitHub 上有没有发布新版本。
有新版时会提示并复制下载链接；还没发布过版本时会给出提示。

【长对话性能】
导入了很长的对话也不会把手机卡死：
· 消息列表一次只渲染最近 30 条，往上滑点「加载更早的 30 条」继续
· 单条超过 8000 字的回复会用纯文本显示（保留内容，只是不排版）
· 侧边栏预览与朗读都只截取前一段文字

"""
if "【检查更新】" not in t:
    t = t.replace("【数据备份】", extra + "【数据备份】")
io.open(p2, "w", encoding="utf-8", newline="\n").write(t)
print("安装说明:", "v1.8.0" in t, "检查更新" in t)
