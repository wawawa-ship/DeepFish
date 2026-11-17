# -*- coding: utf-8 -*-
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(ROOT, "README.md")
s = io.open(p, encoding="utf-8").read()

old_start = "## 开源协议"
idx = s.find(old_start)
if idx >= 0:
    new_block = """## 开源协议

**代码：MIT**（见 [LICENSE](LICENSE)）——可以自由使用、修改、分发，**也允许商用**。

**美术资源：不包含在 MIT 里**（见 [NOTICE](NOTICE)）——图标、默认头像、截图中的角色形象
由 **子午老师** 设计，仅授权在本项目中使用，**不得商用、不得用于其他项目、不得二次创作分发**。

> 如果你 fork 并公开，请先把 `assets/` 和 `www/icons/` 里的图换成你自己的。

本项目是非官方第三方客户端，与 DeepSeek 官方没有隶属或合作关系。

---

### 为什么这样拆

「开源」按 OSI 的定义本身就允许商用，所以「开源 + 不允许商用」在法律文本上无法同时成立。
常见做法是把**代码**和**美术资产**拆开授权：

| 你想要的 | 推荐做法 |
|---|---|
| 代码随便用，图不许拿走 | MIT + NOTICE 声明素材例外 ← **本项目采用** |
| 代码可商用，但改完必须开源 | AGPL-3.0 |
| 整个项目不许商用 | PolyForm Noncommercial（但这不算「开源」，GitHub 会显示 View license） |

贡献前请先读 [CONTRIBUTING.md](CONTRIBUTING.md)，里面有兼容性检查清单。

"""
    s = s[:idx] + new_block
    io.open(p, "w", encoding="utf-8", newline="\n").write(s)
    print("README 协议段已更新")
else:
    print("未找到协议段")
