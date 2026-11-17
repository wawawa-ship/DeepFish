/* 测试：ZIP 勾选导入 + 背景矩形裁剪 + 自动朗读按钮 */
(async function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var out = {};

  // ---- 1. 自动朗读按钮 ----
  var ar = document.getElementById("btnAutoRead");
  out.autoReadBtn = !!ar;
  out.initialPressed = ar.getAttribute("aria-pressed");
  ar.click();
  await sleep(200);
  out.afterToggle = ar.getAttribute("aria-pressed");
  out.stored = Store.state.settings.autoRead;

  // ---- 2. ZIP 勾选 ----
  var resp = await fetch("test-export.zip");
  var blob = await resp.blob();

  document.getElementById("btnImportOpen").click();
  await sleep(320);
  var dt = new DataTransfer();
  dt.items.add(new File([blob], "deepseek_data-x.zip", { type: "application/zip" }));
  var zi = document.getElementById("importZipInput");
  zi.files = dt.files;
  zi.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(1400);

  out.zipItems = document.querySelectorAll(".zip-item").length;
  out.selectedNone = document.querySelectorAll(".zip-item.on").length;
  out.confirmText0 = document.getElementById("btnImportConfirm").textContent.trim();
  out.confirmDisabled = document.getElementById("btnImportConfirm").disabled;

  // 全选
  document.querySelector("[data-zall]").click();
  await sleep(250);
  out.afterSelectAll = document.querySelectorAll(".zip-item.on").length;
  out.confirmTextAll = document.getElementById("btnImportConfirm").textContent.trim();

  // 再点一次 → 全不选
  document.querySelector("[data-zall]").click();
  await sleep(250);
  out.afterUnselectAll = document.querySelectorAll(".zip-item.on").length;

  // 只勾第二个
  var items = document.querySelectorAll(".zip-item");
  items[1].click();
  await sleep(250);
  out.oneSelected = document.querySelectorAll(".zip-item.on").length;
  out.confirmTextOne = document.getElementById("btnImportConfirm").textContent.trim();
  out.pickedTitle = items[1].querySelector(".zip-title").textContent;

  // 导入
  document.getElementById("btnImportConfirm").click();
  await sleep(800);
  var imported = Store.state.sessions.filter(function (s) { return s.title.indexOf("导入") < 0; });
  out.totalSessions = Store.state.sessions.length;
  out.titles = Store.state.sessions.map(function (s) { return s.title; });

  // ---- 3. 背景矩形裁剪 ----
  var bgResp = await fetch("icons/avatar-256.png");
  var bgBlob = await bgResp.blob();
  document.getElementById("btnImportClose").click();
  await sleep(300);
  document.getElementById("btnPersona").click();
  await sleep(350);
  var dt2 = new DataTransfer();
  dt2.items.add(new File([bgBlob], "bg.png", { type: "image/png" }));
  var bf = document.getElementById("bgFile");
  bf.files = dt2.files;
  bf.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(900);

  var vp = document.getElementById("cropViewport");
  out.cropperOpen = document.getElementById("cropper").classList.contains("open");
  out.vpIsRect = vp.classList.contains("rect");
  out.vpW = Math.round(vp.getBoundingClientRect().width);
  out.vpH = Math.round(vp.getBoundingClientRect().height);

  document.getElementById("btnCropOk").click();
  await sleep(700);
  var s = Store.state.sessions[0];
  out.bgSet = !!(s && s.background && s.background.length > 500);
  out.bgLen = s && s.background ? s.background.length : 0;

  return JSON.stringify(out);
})()
