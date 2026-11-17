/* 测试：思考/搜索开关 + 导入文本解析 + 附件 */
(async function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var out = {};

  // 1. 开关切换
  document.getElementById("btnThink").click();
  await sleep(150);
  var s = Store.state.sessions.filter(function (x) { return x.id === "s_light"; })[0];
  out.thinkOn = s.chat.thinking;
  out.thinkAria = document.getElementById("btnThink").getAttribute("aria-pressed");
  out.modelLabel = document.getElementById("modelName").textContent;

  document.getElementById("btnSearch").click();
  await sleep(150);
  out.searchOn = s.chat.webSearch;
  out.modelLabel2 = document.getElementById("modelName").textContent;

  // 2. 导入解析（模拟 DeepSeek 分享文本）
  var sample = [
    "你好",
    "",
    "DeepSeek",
    "你好！有什么可以帮你的吗？",
    "",
    "你：",
    "帮我写一首关于海的诗",
    "",
    "DeepSeek:",
    "当然，这是一首小诗：",
    "海浪拍岸，",
    "月光碎成银。"
  ].join("\n");

  document.getElementById("btnImportOpen").click();
  await sleep(350);
  out.importSheetOpen = document.getElementById("importSheet").classList.contains("open");

  document.getElementById("importText").value = sample;
  document.getElementById("btnImportText").click();
  await sleep(600);

  var news = Store.state.sessions.filter(function (x) { return x.title.indexOf("导入") === 0; });
  out.importedCount = news.length;
  if (news.length) {
    var nn = news[0];
    out.importedTitle = nn.title;
    out.msgCount = nn.messages.length;
    out.roles = nn.messages.map(function (m) { return m.role; }).join(",");
    out.first = nn.messages[0].content.slice(0, 20);
  }

  // 3. 附件（图片）
  var resp = await fetch("icons/avatar-256.png");
  var blob = await resp.blob();
  var dt = new DataTransfer();
  dt.items.add(new File([blob], "pic.png", { type: "image/png" }));
  dt.items.add(new File(["测试文件内容 hello"], "note.txt", { type: "text/plain" }));
  var af = document.getElementById("attachFile");
  af.files = dt.files;
  af.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(900);

  out.attachItems = document.querySelectorAll(".attach-item").length;
  out.stripVisible = !document.getElementById("attachStrip").hidden;

  return JSON.stringify(out);
})()
