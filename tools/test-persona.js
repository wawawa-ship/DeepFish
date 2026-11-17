/* 验证：多会话独立角色 + API 提示词取值 + 旧数据迁移 */
(async function () {
  var now = Date.now();
  var out = {};

  // 1. 两个不同角色的会话
  Store.state.sessions = [
    {
      id: "s_a", title: "和阿蓝聊天", createdAt: now - 60000, updatedAt: now - 1000,
      persona: { name: "阿蓝", prompt: "你是阿蓝，说话慢条斯理。", avatar: "" },
      messages: [
        { id: "m1", role: "user", content: "你好", createdAt: now - 50000 },
        { id: "m2", role: "assistant", content: "你好呀，我是阿蓝。", createdAt: now - 40000 }
      ]
    },
    {
      id: "s_b", title: "和小橘聊天", createdAt: now - 30000, updatedAt: now - 2000,
      persona: { name: "小橘", prompt: "你是小橘，活泼爱用感叹号。", avatar: "" },
      messages: [
        { id: "m3", role: "user", content: "嗨", createdAt: now - 20000 },
        { id: "m4", role: "assistant", content: "嗨嗨嗨！", createdAt: now - 10000 }
      ]
    }
  ];
  Store.state.activeId = "s_a";
  await Store.saveImmediate();

  // 2. 取 API 消息，确认 system 用的是各自角色
  var msgsA = API.buildMessages(Store.state.sessions[0], Store.state.settings);
  var msgsB = API.buildMessages(Store.state.sessions[1], Store.state.settings);
  out.sysA = msgsA[0] && msgsA[0].content;
  out.sysB = msgsB[0] && msgsB[0].content;

  // 3. 旧格式迁移：全局 systemPrompt + 无 persona 的会话
  var report = await Store.importData({
    settings: { systemPrompt: "旧版的全局设定" },
    sessions: [{ id: "s_old", title: "旧对话", messages: [] }]
  }, "replace");
  out.migrateReport = report;
  var oldSession = Store.state.sessions.filter(function (s) { return s.id === "s_old"; })[0];
  out.oldPersonaPrompt = oldSession ? oldSession.persona.prompt : null;
  out.oldDefaultPrompt = Store.state.settings.defaultPersona.prompt;

  // 4. 恢复成两个会话，供截图使用
  Store.state.sessions = [
    {
      id: "s_a", title: "和阿蓝聊天", createdAt: now - 60000, updatedAt: now - 1000,
      persona: { name: "阿蓝", prompt: "你是阿蓝，说话慢条斯理。", avatar: "" },
      messages: [
        { id: "m1", role: "user", content: "你好", createdAt: now - 50000 },
        { id: "m2", role: "assistant", content: "你好呀，我是阿蓝。", createdAt: now - 40000 }
      ]
    },
    {
      id: "s_b", title: "和小橘聊天", createdAt: now - 30000, updatedAt: now - 2000,
      persona: { name: "小橘", prompt: "你是小橘，活泼爱用感叹号。", avatar: "" },
      messages: [
        { id: "m3", role: "user", content: "嗨", createdAt: now - 20000 },
        { id: "m4", role: "assistant", content: "嗨嗨嗨！", createdAt: now - 10000 }
      ]
    }
  ];
  Store.state.activeId = "s_a";
  Store.state.settings.apiKey = "sk-demo";
  await Store.saveImmediate();

  return JSON.stringify(out);
})()
