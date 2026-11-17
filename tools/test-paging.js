/* 测试：长对话分页 + 检查更新 */
(async function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var out = {};

  // ---- 分页 ----
  out.rendered = document.querySelectorAll(".msg").length;
  var btn = document.getElementById("loadMoreBtn");
  out.hasMore = !!btn;
  out.moreText = btn ? btn.textContent.trim() : "";

  if (btn) {
    btn.click();
    await sleep(600);
    out.afterLoad = document.querySelectorAll(".msg").length;

    var b2 = document.getElementById("loadMoreBtn");
    if (b2) { b2.click(); await sleep(500); }
    out.afterLoad2 = document.querySelectorAll(".msg").length;
  }

  // ---- 检查更新 ----
  document.getElementById("btnSettings").click();
  await sleep(450);
  var cu = document.getElementById("btnCheckUpdate");
  out.hasCheckBtn = !!cu;

  if (cu) {
    cu.click();
    await sleep(5000);
    var modal = document.getElementById("modal");
    out.modalVisible = modal ? !modal.hidden : null;
    out.modalTitle = document.getElementById("modalTitle").textContent;
    out.toast = document.getElementById("toast").textContent;
    out.btnBack = cu.textContent.trim();
    out.btnEnabled = !cu.disabled;
  }

  return JSON.stringify(out);
})()
