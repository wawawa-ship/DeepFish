/* 验证存储层：导出、导入（合并/替换）、快照、统计 */
(async function () {
  var out = {};
  try {
    var u = Store.uid("s");
    out.uidFormat = /^s_[0-9a-z]+_[0-9a-z]+$/.test(u);

    // 1. 导出（不含 Key）
    var pack = Store.exportFile(false);
    var obj = JSON.parse(pack.json);
    out.fileName = pack.name;
    out.app = obj.app;
    out.schemaVersion = obj.schemaVersion;
    out.sessionCount = obj.sessions.length;
    out.keyStripped = obj.settings.apiKey === "";
    out.hasExportedAt = !!obj.exportedAt;

    // 2. 改一下再合并导入（模拟从备份恢复）
    var beforeCount = Store.state.sessions.length;
    var report = await Store.importData(obj, "merge");
    out.merge = report;
    out.mergeKept = Store.state.sessions.length === beforeCount;

    // 3. 替换导入
    var r2 = await Store.importData(obj, "replace");
    out.replace = r2;
    out.replaceCount = Store.state.sessions.length;
    // 替换时本机 API Key 应保留
    out.keyPreserved = Store.state.settings.apiKey !== "";

    // 4. 快照
    var ts = await Store.createSnapshot(true);
    out.snapshotCreated = !!ts;
    var list = await Store.listSnapshots();
    out.snapshotCount = list.length;

    // 5. 恢复快照
    if (list.length) {
      await Store.restoreSnapshot(list[0].key);
      out.restoreOk = Store.state.sessions.length > 0;
    }

    // 6. 统计
    out.stats = Store.stats();

    // 7. 畸形数据不应崩溃
    try {
      await Store.importData({ foo: 1 }, "merge");
      out.badImport = "no-throw";
    } catch (e) {
      out.badImport = "threw:" + e.message;
    }

    return JSON.stringify(out);
  } catch (e) {
    return JSON.stringify({ fatal: e.message, stack: String(e.stack).slice(0, 300) });
  }
})()
