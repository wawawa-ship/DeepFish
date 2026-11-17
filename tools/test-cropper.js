/* 打开角色面板 → 模拟"从相册选图" → 打开裁剪器 */
(async function () {
  document.getElementById("btnPersona").click();
  await new Promise(function (r) { setTimeout(r, 450); });

  var resp = await fetch("icons/avatar-256.png");
  var blob = await resp.blob();
  var dt = new DataTransfer();
  dt.items.add(new File([blob], "picked.png", { type: "image/png" }));

  var input = document.getElementById("avatarFile");
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));

  await new Promise(function (r) { setTimeout(r, 700); });
  return document.getElementById("cropper").classList.contains("open") ? "cropper-open" : "cropper-closed";
})()
