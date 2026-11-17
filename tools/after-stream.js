/* 模拟 DeepSeek 流式返回，验证打字机效果与最终 Markdown 渲染 */
(async function () {
  var chunks = [
    "好的，", "我", "用", "一个", "小", "例子", "说明", "：", "\n\n",
    "### ", "三步", "走", "\n\n",
    "1. ", "先", "**观察**", "\n",
    "2. ", "再", "`假设`", "\n",
    "3. ", "最后", "验证", "\n\n",
    "```js\n",
    "const ok = true;\n",
    "console.log(ok);\n",
    "```\n\n",
    "> ", "结论", "：", "这就是", "全部", "。"
  ];

  var enc = new TextEncoder();

  window.fetch = function () {
    var i = 0;
    var stream = new ReadableStream({
      start: function (c) {
        function next() {
          if (i >= chunks.length) {
            c.enqueue(enc.encode("data: [DONE]\n\n"));
            c.close();
            return;
          }
          var piece = chunks[i++];
          var payload = "data: " + JSON.stringify({
            choices: [{ delta: { content: piece } }]
          }) + "\n\n";
          c.enqueue(enc.encode(payload));
          setTimeout(next, 50);
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
  input.value = "测试流式输出，带列表和代码";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  document.getElementById("btnSend").click();
  return "sent";
})()
