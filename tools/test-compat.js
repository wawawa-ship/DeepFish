/* 兼容性加固验证：覆盖层可见性、iOS 规则不误伤安卓、裁剪拖动绑定 */
(async function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var out = {};

  function vis(id) {
    var el = document.getElementById(id);
    return el ? getComputedStyle(el).visibility : "missing";
  }

  // 1. 关闭状态下四个面板都应是 hidden
  out.closed = {
    settings: vis("settingsSheet"),
    persona: vis("personaSheet"),
    import: vis("importSheet"),
    cropper: vis("cropper"),
    drawer: vis("drawer")
  };

  // 2. 打开设置 → visible
  document.getElementById("btnMenu").click();
  await sleep(320);
  document.getElementById("btnSettings").click();
  await sleep(500);
  out.settingsOpen = vis("settingsSheet");
  out.drawerClosed = vis("drawer");

  // 3. 关闭 → hidden
  document.getElementById("btnSettingsClose").click();
  await sleep(450);
  out.settingsClosed = vis("settingsSheet");

  // 4. iOS 专用规则不应在安卓/Chromium 上生效
  out.prefersIOS = CSS.supports ? CSS.supports("-webkit-touch-callout", "none") : null;
  var inp = document.getElementById("input");
  out.inputFontSize = getComputedStyle(inp).fontSize;

  // 5. 关键 CSS 是否真的生效
  out.hiddenRule = getComputedStyle(document.getElementById("modal")).display;

  // 6. 裁剪拖动绑定方式
  out.hasPointer = !!window.PointerEvent;

  return JSON.stringify(out);
})()
