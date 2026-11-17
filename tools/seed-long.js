(async function () {
  var now = Date.now();
  var msgs = [];
  for (var i = 0; i < 200; i++) {
    msgs.push({
      id: "m" + i,
      role: i % 2 === 0 ? "user" : "assistant",
      content: "第 " + (i + 1) + " 条：" +
        (i % 2 === 0 ? "这是用户提的问题" : "这是模型的回答，用来占位测试渲染性能。"),
      createdAt: now - (200 - i) * 60000
    });
  }
  Store.state.settings.agreedNotice = true;
  Store.state.settings.apiKey = "sk-demo";
  Store.state.settings.theme = "dark";
  Store.state.sessions = [{
    id: "s_long",
    title: "超长对话（200 条）",
    createdAt: now - 200 * 60000,
    updatedAt: now,
    persona: { name: "DeepFish", prompt: "", avatar: "" },
    chat: { thinking: false, webSearch: false, model: "" },
    background: "",
    messages: msgs
  }];
  Store.state.activeId = "s_long";
  await Store.saveImmediate();
  return "ok";
})()
