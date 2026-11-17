(async function () {
  Store.state.sessions = [];
  Store.state.activeId = null;
  Store.state.settings.apiKey = "sk-demo";
  Store.state.settings.defaultPersona = { name: "深海鱼", prompt: "你是一条生活在深海的鱼，说话很慢。", avatar: "" };
  await Store.saveImmediate();
  return "ok";
})()
