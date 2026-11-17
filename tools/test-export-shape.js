/* 检查导出备份的内容结构 */
(function () {
  var pack = Store.exportFile(false);
  var obj = JSON.parse(pack.json);
  var s0 = obj.sessions[0] || {};
  return JSON.stringify({
    fileName: pack.name,
    sizeKB: Math.round(pack.size / 1024),
    app: obj.app,
    schemaVersion: obj.schemaVersion,
    appVersion: obj.appVersion,
    exportedAt: !!obj.exportedAt,
    keyStripped: obj.settings.apiKey === "",
    sessionCount: obj.sessions.length,
    sessionFields: Object.keys(s0),
    persona: s0.persona,
    chat: s0.chat,
    hasBackground: !!(s0.background && s0.background.length > 100),
    msgFields: (s0.messages && s0.messages[0]) ? Object.keys(s0.messages[0]) : []
  });
})()
