(async function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var sample = [
    "你：",
    "帮我把这段话改得正式一点",
    "",
    "DeepSeek：",
    "当然可以，请把原文发给我。",
    "",
    "你：",
    "好的：我想申请调休一天",
    "",
    "DeepSeek：",
    "已改写为：本人拟申请调休一日，恳请批准。"
  ].join("\n");

  document.getElementById("btnImportOpen").click();
  await sleep(350);
  document.getElementById("importText").value = sample;
  document.getElementById("btnImportText").click();
  await sleep(500);

  var box = document.getElementById("importPreview");
  if (box.scrollIntoView) box.scrollIntoView({ block: "center" });
  await sleep(400);
  return "preview:" + document.querySelectorAll(".preview-item").length;
})()
