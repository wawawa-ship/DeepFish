(async function () {
  Store.state.settings.apiKey = "sk-demo-key-for-preview";
  Store.state.settings.stream = true;
  Store.state.sessions = [{
    id: "s_stream",
    title: "测试流式输出",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false,
    messages: []
  }];
  Store.state.activeId = "s_stream";
  await Store.saveImmediate();
  return "ok";
})()
