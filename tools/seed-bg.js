(async function () {
  // 生成一张渐变图当背景
  var c = document.createElement("canvas");
  c.width = 720; c.height = 1400;
  var ctx = c.getContext("2d");
  var g = ctx.createLinearGradient(0, 0, 720, 1400);
  g.addColorStop(0, "#2b5876");
  g.addColorStop(0.5, "#4e4376");
  g.addColorStop(1, "#1b2a41");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 720, 1400);
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = "#9ad0ff";
  for (var i = 0; i < 40; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * 720, Math.random() * 1400, Math.random() * 60 + 10, 0, Math.PI * 2);
    ctx.fill();
  }
  var url = c.toDataURL("image/jpeg", 0.85);

  Store.state.settings.agreedNotice = true;
  Store.state.settings.theme = "dark";
  Store.state.settings.apiKey = "sk-demo";
  Store.state.sessions = [{
    id: "s_bg", title: "背景图测试", createdAt: Date.now() - 5000, updatedAt: Date.now(),
    persona: { name: "DeepFish", prompt: "", avatar: "" },
    chat: { thinking: false, webSearch: false, model: "" },
    background: url,
    messages: [
      { id: "m1", role: "user", content: "这张背景好看吗？", createdAt: Date.now() - 4000 },
      { id: "m2", role: "assistant", content: "背景已经生效了，文字依然清晰可读。你可以随时在「角色设定」里换掉它。", createdAt: Date.now() - 3000 }
    ]
  }];
  Store.state.activeId = "s_bg";
  await Store.saveImmediate();
  return "ok";
})()
