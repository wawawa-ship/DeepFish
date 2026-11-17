/* 测试：token 用量计费 + 图标化操作栏 */
(async function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var chunks = ["这是", "一条", "用来", "测试", "计费", "的回复。"];
  var enc = new TextEncoder();
  var i = 0;

  window.fetch = function () {
    var stream = new ReadableStream({
      start: function (c) {
        function next() {
          if (i >= chunks.length) {
            c.enqueue(enc.encode("data: " + JSON.stringify({
              choices: [{ delta: { content: "" }, finish_reason: "stop" }]
            }) + "\n\n"));
            c.enqueue(enc.encode("data: " + JSON.stringify({
              choices: [],
              usage: {
                prompt_tokens: 1234,
                completion_tokens: 567,
                total_tokens: 1801,
                prompt_cache_hit_tokens: 1000,
                prompt_cache_miss_tokens: 234,
                server_tool_use: { tool_search: 1, tool_fetch: 0 }
              }
            }) + "\n\n"));
            c.enqueue(enc.encode("data: [DONE]\n\n"));
            c.close();
            return;
          }
          c.enqueue(enc.encode("data: " + JSON.stringify({
            choices: [{ delta: { content: chunks[i++] } }]
          }) + "\n\n"));
          setTimeout(next, 30);
        }
        next();
      }
    });
    return Promise.resolve(new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    }));
  };

  var input = document.getElementById("input");
  input.value = "测试计费";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  document.getElementById("btnSend").click();

  await sleep(1800);

  var out = {};
  var acts = document.querySelectorAll(".msg.ai .actions .act");
  out.actCount = acts.length;
  out.anyTextLabel = Array.prototype.some.call(acts, function (a) {
    return /复制|删除|朗读|重新生成/.test(a.textContent);
  });
  out.ariaLabels = Array.prototype.map.call(acts, function (a) {
    return a.getAttribute("aria-label");
  });

  var ub = document.querySelector(".usage-btn");
  out.usageBtnText = ub ? ub.textContent.trim() : null;

  var sess = Store.state.sessions[0];
  var lastAi = null;
  sess.messages.forEach(function (m) { if (m.role === "assistant") lastAi = m; });
  out.cost = lastAi && lastAi.cost ? lastAi.cost : null;

  if (ub) {
    ub.click();
    await sleep(300);
  }
  var card = document.querySelector(".usage-card");
  out.cardVisible = card ? !card.hidden : false;
  out.cardText = card ? card.textContent.replace(/\s+/g, " ").trim() : "";

  // 再点一次收起
  if (ub) { ub.click(); await sleep(200); }
  var card2 = document.querySelector(".usage-card");
  out.cardClosedAgain = card2 ? card2.hidden : null;

  return JSON.stringify(out);
})()
