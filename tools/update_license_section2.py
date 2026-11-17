# -*- coding: utf-8 -*-
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(ROOT, "README.md")
s = io.open(p, encoding="utf-8").read()

idx = s.find("## 开源协议")
if idx < 0:
    print("未找到协议段")
else:
    block = """## 开源协议

本项目把**代码**和**美术资产**分开授权：

| 部分 | 许可 | 能否商用 |
|---|---|---|
| 代码（`www/`、`android/`、`tools/`） | [MIT](LICENSE) | ✅ 可以 |
| 美术（图标、默认头像、截图中的角色形象） | [NOTICE](NOTICE) 第 2 节 | ❌ 不可以 |

**角色形象**由 **子午老师** 设计。作者已在公开简介里授权使用这个形象，
条件是**不得用于商业用途**。所以在个人项目、非商业项目、以及本项目的 fork 里都可以用。

要商用的话，请另行联系作者，或者直接把 `www/icons/` 和 `assets/` 里的图换成你自己的——
代码不需要任何修改，换掉图片就能跑。

> 顺带说明：OSI 定义下的「开源」本身就允许商用，所以「开源 + 不许商用」没法用同一个许可证表达。
> 把代码和美术拆成两个许可，是这类项目的标准做法（很多带角色的开源项目都这么处理）。

本项目是非官方第三方客户端，与 DeepSeek 官方没有隶属或合作关系。

贡献前请先读 [CONTRIBUTING.md](CONTRIBUTING.md)，里面有兼容性检查清单。
"""
    s = s[:idx] + block
    io.open(p, "w", encoding="utf-8", newline="\n").write(s)
    print("README 协议段已更新")

# 顺手把「关于」页的措辞改准确
p2 = os.path.join(ROOT, "www", "index.html")
h = io.open(p2, encoding="utf-8").read()
h = h.replace(
    "角色形象由 <b>子午老师</b> 设计（已授权使用）。",
    "角色形象由 <b>子午老师</b> 设计，作者已授权非商业使用。",
)
io.open(p2, "w", encoding="utf-8", newline="\n").write(h)
print("关于页措辞已更新")
