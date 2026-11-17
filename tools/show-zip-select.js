(async function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var resp = await fetch("test-export.zip");
  var blob = await resp.blob();

  document.getElementById("btnImportOpen").click();
  await sleep(320);
  var dt = new DataTransfer();
  dt.items.add(new File([blob], "deepseek_data-x.zip", { type: "application/zip" }));
  var zi = document.getElementById("importZipInput");
  zi.files = dt.files;
  zi.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(1300);

  // 勾选第一个，展示选中态
  var items = document.querySelectorAll(".zip-item");
  if (items[0]) items[0].click();
  await sleep(300);

  var box = document.getElementById("importPreview");
  if (box.scrollIntoView) box.scrollIntoView({ block: "center" });
  await sleep(400);
  return "items:" + items.length;
})()
