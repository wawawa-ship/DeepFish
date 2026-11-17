# 贡献指南

感谢你愿意一起完善 DeepFish。这个项目最怕的不是功能少，而是**在某台手机上突然点不动**，
所以下面有一份兼容性检查清单，改 UI 前请务必过一遍。

## 项目结构

```
www/                  应用本体（纯静态，无构建步骤）
  index.html
  css/app.css
  js/
    md.js             Markdown 渲染（自带 XSS 转义）
    dszip.js          DeepSeek 导出包（ZIP）解析
    store.js          存储层（IndexedDB + localStorage 兜底）
    api.js            DeepSeek API 客户端（SSE、TTS）
    app.js            主逻辑与全部 UI
android/              Capacitor 安卓工程
tools/                本地服务器、图标生成、兼容性测试脚本
assets/               原图与截图
```

页面代码是**原生 JS**，不经过打包器。改完 `www/` 里的文件，`npx cap copy android`
再重新构建即可，不需要 `npm run build`。

## 本地运行

```bash
npm install
npx serve www        # 或 node tools/serve.js（默认 5180 端口）
```

浏览器打开 `http://127.0.0.1:5180/` 即可调试。

## 构建

### 安卓

```bash
npx cap copy android
cd android && ./gradlew assembleRelease
```

需要 JDK 17 + Android SDK 34。首次构建前：

```bash
npx cap add android
```

### iOS

**必须使用 macOS + Xcode**，Windows / Linux 无法构建 iOS 包。

```bash
npm install
npx cap add ios
npx cap copy ios
npx cap open ios      # 在 Xcode 里签名并运行
```

没有 Mac 的话，iOS 用户可以直接用 PWA：把 `www/` 部署到任意 HTTPS 静态托管，
Safari 打开后「共享 → 添加到主屏幕」，效果接近原生，也支持离线。

## 兼容性检查清单

改 UI 或加交互时，请逐条确认。iQOO 上那个「整屏点不动」的 bug 就是第 1 条引起的。

### 1. 不要把「隐藏」交给 transform

```css
/* ❌ 危险：如果设备合成层不裁剪，元素仍在屏幕外但会拦住点击 */
.panel { position: fixed; inset: 0; transform: translateX(100%); }

/* ✅ 安全：关闭时同时把它变成不可见、不可点 */
.panel { visibility: hidden; pointer-events: none; }
.panel.open { visibility: visible; pointer-events: auto; }
```

同理，用 `hidden` 属性隐藏的元素，**不要**在 CSS 里给它写 `display: flex/block`，
否则会盖过浏览器的 `[hidden] { display: none }`。项目里已加：

```css
[hidden] { display: none !important; }
```

新增弹层时请照抄这个模式。

### 2. 新特性要给旧内核留退路

目标基线是 **Chromium 90+ / iOS Safari 15+**。避免或降级使用：

| 特性 | 最低版本 | 建议 |
|---|---|---|
| `:has()` | Chrome 105 / iOS 15.4 | 避免 |
| `dvh` / `svh` | Chrome 108 / iOS 15.4 | 用 `--app-h` |
| `color-mix()` | Chrome 111 | 避免 |
| `inset: 0` | Chrome 87 | 同时写 `top/left/right/bottom` |
| `DecompressionStream` | Chrome 80 / **iOS 16.4** | 已有兜底提示 |
| `PointerEvent` | iOS 13 | 拖动逻辑已有 touch 退路 |

### 3. iOS 的几条硬规则

- 输入框 `font-size` 必须 ≥ 16px，否则聚焦时整页会被放大（已用 `@supports (-webkit-touch-callout)` 处理）
- 音频必须由用户手势解锁后才能播放（`unlockAudio()`）
- `<a download>` 不生效，导出用 `navigator.share` 或兜底下载
- `100vh` 含地址栏，用 `--app-h`（`updateViewport()` 计算）
- 安全区用 `env(safe-area-inset-*)`，需要 `viewport-fit=cover`

### 4. 改动后跑一遍

```bash
node tools/cdp.js --url=http://127.0.0.1:5180/ \
  --afterFile=tools/test-compat.js
```

它会检查四个面板的关闭态是否 `visibility: hidden`、`[hidden]` 是否真正生效、
以及 iOS 专用规则有没有误伤安卓。

## 代码风格

- 原生 ES5 风格（`var` / `function`），不用箭头函数和可选链，方便老内核
- 所有用户可见文案用中文，英文界面暂未国际化
- 新增 CSS 请放在 `app.css` 对应分区，并用 `var(--...)` 取色

## 提交 PR

1. Fork 后从 `main` 拉分支
2. 只改必要文件，**不要提交** `node_modules/`、`android/build/`、`*.jks`、`dist/*.apk`
3. 说明改了什么、在哪些设备上测过（机型 + 系统版本）
4. 涉及 UI 的改动请附截图

## 不要做的事

- 不要把 API Key、签名文件、个人数据写进仓库
- 不要移除 `www/` 的能力去依赖构建工具（保持零构建是这个项目的取舍）
- 不要为了炫技使用新 CSS/JS 特性——兼容性优先于视觉效果
