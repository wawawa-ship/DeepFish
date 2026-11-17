# -*- coding: utf-8 -*-
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(ROOT, "README.md")
s = io.open(p, encoding="utf-8").read()

# 语言切换
if "README.en.md" not in s.split("\n\n")[1] if "\n\n" in s else False:
    pass
s = s.replace("# DeepFish\n", "# DeepFish\n\n[English](README.en.md) | 中文\n", 1)

compat = """## 八、跨平台兼容（Android / iOS）

| 平台 | 状态 |
|---|---|
| Android 5.1 ~ 16 | ✅ 实测 vivo iQOO、华为 Mate 20（HarmonyOS 4.0） |
| iOS 15+（PWA） | ✅ 安全区、防输入缩放、音频解锁都已处理 |
| iOS 原生 | 可构建，但需要 macOS + Xcode 签名 |
| 桌面浏览器 | ✅ Chromium 90+ / Safari 15+ / Firefox 100+ |

> **为什么不用 `transform` 把面板移出屏幕来隐藏？**
> 因为部分设备的合成层不会正确裁剪移出屏幕的元素，会留下一层**看不见的全屏遮罩**，
> 把所有点击都吃掉。iQOO 上那个「整屏点不动」的 bug 就是这么来的。
> 现在所有全屏面板在关闭时都是 `visibility: hidden; pointer-events: none`，
> 并且启动后会自检一次，把异常可见的面板强制隐藏。

### iOS 上怎么用

没有 Mac 也能用：把 `www/` 部署到任意 HTTPS 静态托管，Safari 打开后
「共享 → 添加到主屏幕」，效果接近原生，支持离线。

有 Mac 的话可以打原生包：

```bash
npx cap add ios
npx cap copy ios
npx cap open ios
```

### iOS 与其他平台的已知差异

- 导出备份走系统「分享 / 存储到文件」，不是直接下载
- 朗读需要用户点一次喇叭解锁音频（iOS 的自动播放限制），之后自动朗读正常
- 导入 `deepseek_data-*.zip` 需要 iOS 16.4+（系统解压能力），更早版本会提示改用 JSON
- 桌面浏览器上，部分系统会拦截自动播放，同样点一下即可

"""

anchor = "## 八、华为 Mate 20"
if anchor in s and "## 八、跨平台兼容" not in s:
    s = s.replace(anchor, compat + anchor.replace("八、", "九、"), 1)
    # 后面的编号顺延
    for old, new in [("九、常见问题", "十、常见问题"), ("十、目录结构", "十一、目录结构")]:
        s = s.replace(old, new, 1)

license_block = """
## 开源协议

代码以 **MIT** 协议开源，详见 [LICENSE](LICENSE)。

⚠️ 图标与默认头像使用的是 **子午老师** 设计的角色形象，**已获授权**在本项目中使用，
但**不包含在 MIT 协议范围内**，请勿单独拿走使用。

本项目是非官方第三方客户端，与 DeepSeek 官方没有隶属或合作关系。

贡献前请先读 [CONTRIBUTING.md](CONTRIBUTING.md)，里面有兼容性检查清单。

"""
if "## 开源协议" not in s:
    s = s.replace("版本 1.6.0", license_block + "版本 1.7.0", 1)
    s = s.replace("版本 1.7.0\n\n### 更新记录", "版本 1.7.0\n\n### 更新记录", 1)

# 更新记录
s = s.replace(
    "- **1.6.0**：新增用量与费用显示",
    "- **1.7.0**：开源准备与跨平台加固。所有全屏面板关闭时改为 `visibility: hidden`，\n"
    "  启动后自检覆盖层（防止再次出现「透明遮罩吃点击」）；新增 iOS 专项适配\n"
    "  （输入框 16px 防缩放、音频解锁、安全区、分享式导出兜底、指针事件降级）；\n"
    "  补齐 LICENSE / CONTRIBUTING / 英文 README。\n"
    "- **1.6.0**：新增用量与费用显示",
    1,
)

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("README ok:", "跨平台兼容" in s, "开源协议" in s, "1.7.0" in s)
