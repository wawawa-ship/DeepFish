(async function () {
  Store.state.settings.agreedNotice = true;
  Store.state.settings.theme = "light";
  Store.state.settings.apiKey = "sk-demo";
  Store.state.settings.defaultPersona = { name: "DeepFish", prompt: "", avatar: "" };
  Store.state.sessions = [
    {
      id: "s_light", title: "浅色主题检查", createdAt: Date.now() - 5000, updatedAt: Date.now(),
      persona: { name: "DeepFish", prompt: "", avatar: "" },
      chat: { thinking: false, webSearch: false, model: "" },
      background: "",
      messages: [
        { id: "m1", role: "user", content: "浅色下左边还有黑边吗？", createdAt: Date.now() - 4000 },
        { id: "m2", role: "assistant", content: "这条回复用来检查左侧边缘是否还有诡异的深色渐变。", createdAt: Date.now() - 3000 }
      ]
    }
  ];
  Store.state.activeId = "s_light";
  await Store.saveImmediate();
  return "ok";
})()
