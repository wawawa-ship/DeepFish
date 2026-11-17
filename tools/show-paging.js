(async function () {
  await new Promise(function (r) { setTimeout(r, 300); });
  var c = document.getElementById("chat");
  c.scrollTop = 0;
  await new Promise(function (r) { setTimeout(r, 500); });
  return "top:" + document.querySelectorAll(".msg").length;
})()
