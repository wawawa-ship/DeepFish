/* 验证：在会话 A 改角色名，不会影响会话 B */
(async function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var out = {};

  document.getElementById("btnPersona").click();
  await sleep(350);
  out.scopeLabel = document.getElementById("personaScope").textContent;

  var n = document.getElementById("personaName");
  n.value = "阿蓝改";
  n.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(250);

  var a = Store.state.sessions.filter(function (s) { return s.id === "s_a"; })[0];
  var b = Store.state.sessions.filter(function (s) { return s.id === "s_b"; })[0];
  out.personaA = a.persona.name;
  out.personaB = b.persona.name;

  document.getElementById("btnPersonaClose").click();
  await sleep(300);
  out.topName = document.getElementById("personaNameTop").textContent;
  out.msgHeadName = (document.querySelector(".msg-head .who") || {}).textContent;

  return JSON.stringify(out);
})()
