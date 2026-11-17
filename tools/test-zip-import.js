/* 测试：DeepSeek 导出 ZIP 导入 */
(async function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var out = {};

  var resp = await fetch("test-export.zip");
  var blob = await resp.blob();

  document.getElementById("btnImportOpen").click();
  await sleep(350);

  var dt = new DataTransfer();
  dt.items.add(new File([blob], "deepseek_data-test.zip", { type: "application/zip" }));
  var zi = document.getElementById("importZipInput");
  zi.files = dt.files;
  zi.dispatchEvent(new Event("change", { bubbles: true }));

  await sleep(1500);

  out.previewVisible = !document.getElementById("importPreview").hidden;
  out.confirmText = document.getElementById("btnImportConfirm").textContent.trim();
  out.summary = (document.querySelector(".zip-summary") || {}).textContent || "";
  out.rows = document.querySelectorAll(".preview-item").length;

  // 执行导入
  document.getElementById("btnImportConfirm").click();
  await sleep(900);

  out.sessionCount = Store.state.sessions.length;
  out.titles = Store.state.sessions.map(function (s) { return s.title; });
  var a = Store.state.sessions.filter(function (s) { return s.title === "关于海的诗"; })[0];
  if (a) {
    out.msgCount = a.messages.length;
    out.roles = a.messages.map(function (m) { return m.role; }).join(",");
    out.hasReasoning = a.messages.some(function (m) { return m.reasoning && m.reasoning.length > 0; });
    out.secondReply = (a.messages[3] || {}).content || "";
  }
  var b = Store.state.sessions.filter(function (s) { return s.title === "Python 学习计划"; })[0];
  if (b) {
    out.bMsgCount = b.messages.length;
    out.bRoles = b.messages.map(function (m) { return m.role; }).join(",");
  }
  return JSON.stringify(out);
})()
