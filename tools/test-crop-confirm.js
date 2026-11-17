/* 完整流程：选图 → 裁剪 → 完成 → 校验保存 */
(async function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  document.getElementById("btnPersona").click();
  await sleep(400);

  var resp = await fetch("icons/avatar-256.png");
  var blob = await resp.blob();
  var dt = new DataTransfer();
  dt.items.add(new File([blob], "picked.png", { type: "image/png" }));
  var input = document.getElementById("avatarFile");
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(800);

  // 放大一点再确认，验证缩放逻辑
  var zoom = document.getElementById("cropZoom");
  zoom.value = 1.6;
  zoom.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(200);

  document.getElementById("btnCropOk").click();
  await sleep(600);

  var shown = document.getElementById("personaAvatar").getAttribute("src") || "";
  var stored = (Store.state.settings.defaultPersona.avatar || "");
  return JSON.stringify({
    shownIsDataUrl: shown.indexOf("data:image/jpeg") === 0,
    shownLen: shown.length,
    storedIsDataUrl: stored.indexOf("data:image/jpeg") === 0,
    storedLen: stored.length,
    cropperClosed: !document.getElementById("cropper").classList.contains("open")
  });
})()
