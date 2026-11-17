/* 验证 system 合并 + 角色护栏 */
(function () {
  var s = Store.state.sessions[0];
  s.persona = { name: "阿蓝", prompt: "你是阿蓝，一条生活在深海的鱼，说话很慢，喜欢用比喻。", avatar: "" };
  s.messages = [
    { id: "u1", role: "user", content: "你好", createdAt: Date.now() },
    { id: "a1", role: "assistant", content: "你好呀。", createdAt: Date.now() + 1000 }
  ];

  // 关闭联网
  s.chat = { thinking: false, webSearch: false, model: "" };
  var off = API.buildMessages(s, Store.state.settings);

  // 开启联网
  s.chat = { thinking: false, webSearch: true, model: "" };
  var on = API.buildMessages(s, Store.state.settings);

  function sys(list) {
    return list.filter(function (m) { return m.role === "system"; });
  }

  var so = sys(off);
  var sn = sys(on);

  return JSON.stringify({
    systemCountOff: so.length,
    systemCountOn: sn.length,
    hasGuard: so[0] ? so[0].content.indexOf("保持一致的规则") !== -1 : false,
    hasName: so[0] ? so[0].content.indexOf("阿蓝") !== -1 : false,
    onHasToolLine: sn[0] ? sn[0].content.indexOf("联网搜索") !== -1 : false,
    onToolIsInSystem: sn.length === 1 && sn[0].content.indexOf("联网搜索") !== -1,
    ctxDefault: Store.state.settings.contextLimit,
    firstNonSystem: off[0] && off[0].role !== "system" ? off[0].role : off[1] ? off[1].role : "?"
  });
})()
