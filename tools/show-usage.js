(async function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var chunks = ["这是", "一条", "测试", "计费", "的回复。"];
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
                prompt_tokens: 1234, completion_tokens: 567, total_tokens: 1801,
                prompt_cache_hit_tokens: 1000, prompt_cache_miss_tokens: 234,
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
          setTimeout(next, 25);
        }
        next();
      }
    });
    return Promise.resolve(new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
  };

  var input = document.getElementById("input");
  input.value = "给我讲讲海浪";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  document.getElementById("btnSend").click();
  await sleep(1600);

  var ub = document.querySelector(".usage-btn");
  if (ub) ub.click();
  await sleep(400);
  return "opened:" + (ub ? ub.textContent : "none");
})()
