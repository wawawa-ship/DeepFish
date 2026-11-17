/* 测试：导入预览 → 纠正角色 → 确认导入；以及 JSON 文件导入 */
(async function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var out = {};

  // ---- 1. 文本导入 + 角色纠正 ----
  var sample = [
    "帮我把这段话改得正式一点",
    "DeepSeek",
    "当然可以，请把原文发给我。",
    "好的：我想申请调休一天",
    "DeepSeek",
    "已改写为：本人拟申请调休一日，恳请批准。"
  ].join("\n");

  document.getElementById("btnImportOpen").click();
  await sleep(350);
  document.getElementById("importText").value = sample;
  document.getElementById("btnImportText").click();
  await sleep(400);

  out.previewVisible = !document.getElementById("importPreview").hidden;
  out.previewItems = document.querySelectorAll(".preview-item").length;
  out.confirmBtnText = document.getElementById("btnImportConfirm").textContent.trim();

  // 把第 1 条从"用户"改成"AI"，再改回来
  var firstRole = document.querySelector('[data-pi="0"]');
  out.beforeRole = firstRole.textContent.trim();
  firstRole.click();
  await sleep(200);
  out.afterToggle = document.querySelector('[data-pi="0"]').textContent.trim();
  document.querySelector('[data-pi="0"]').click();
  await sleep(200);

  // 删除最后一条
  var delBtns = document.querySelectorAll("[data-pd]");
  var lastDel = delBtns[delBtns.length - 1];
  lastDel.click();
  await sleep(200);
  out.afterDelete = document.querySelectorAll(".preview-item").length;

  // 确认导入
  document.getElementById("btnImportConfirm").click();
  await sleep(600);

  var news = Store.state.sessions.filter(function (s) { return s.title.indexOf("导入") === 0; });
  out.importedSessions = news.length;
  if (news.length) {
    out.msgCount = news[0].messages.length;
    out.roles = news[0].messages.map(function (m) { return m.role; }).join(",");
  }

  // ---- 2. JSON 文件导入 ----
  var json = JSON.stringify([
    { role: "user", content: "JSON 导入测试一" },
    { role: "assistant", content: "JSON 导入测试二" }
  ]);
  var dt = new DataTransfer();
  dt.items.add(new File([json], "export.json", { type: "application/json" }));
  var fi = document.getElementById("importFileInput");
  fi.files = dt.files;
  fi.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(700);

  out.jsonPreviewItems = document.querySelectorAll(".preview-item").length;
  out.jsonConfirmVisible = !document.getElementById("btnImportConfirm").hidden;

  return JSON.stringify(out);
})()
