/* ==========================================================================
   DeepSeek 官方导出包（deepseek_data-*.zip）解析
   结构：
     manifest.json                  { export_format_version: 3 }
     chat_session_index.json        [{ id, inserted_at, updated_at }]
     chat_sessions/{id}.json        { id, title, current_message_id, messages[] }
     messages[].fragments[]         REQUEST / RESPONSE / THINK / FILE / TOOL_*
   ========================================================================== */
(function (global) {
  "use strict";

  var SIG_EOCD = 0x06054b50;
  var SIG_CD = 0x02014b50;
  var SIG_LOCAL = 0x04034b50;

  function decodeName(bytes) {
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch (e) {
      var s = "";
      for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return s;
    }
  }

  function findEOCD(dv, total) {
    var min = Math.max(0, total - 22 - 65535);
    for (var i = total - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === SIG_EOCD) return i;
    }
    return -1;
  }

  /* 解压单个条目（store 或 deflate） */
  function inflateEntry(dv, offset, method, compSize) {
    var nameLen = dv.getUint16(offset + 26, true);
    var extraLen = dv.getUint16(offset + 28, true);
    var start = offset + 30 + nameLen + extraLen;
    var raw = new Uint8Array(dv.buffer, dv.byteOffset + start, compSize);

    if (method === 0) {
      return Promise.resolve(raw);
    }
    if (method !== 8) {
      return Promise.reject(new Error("不支持的压缩方式：" + method));
    }
    if (typeof DecompressionStream === "undefined") {
      return Promise.reject(new Error(
        "当前系统的 WebView 太旧，不支持解压 ZIP。\n" +
        "解决办法：在电脑上把 zip 解压，然后把里面 chat_sessions 文件夹中的 .json 文件\n" +
        "通过「导入导出文件」逐个传进来。"
      ));
    }

    var ds = new DecompressionStream("deflate-raw");
    var stream = new Blob([raw]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  /* 列出 ZIP 内所有条目：{ name, method, compSize, offset } */
  function listEntries(buffer) {
    var dv = new DataView(buffer);
    var eocd = findEOCD(dv, buffer.byteLength);
    if (eocd < 0) throw new Error("不是有效的 ZIP 文件（找不到目录结尾）");

    var count = dv.getUint16(eocd + 10, true);
    var cdOffset = dv.getUint32(eocd + 16, true);
    var p = cdOffset;
    var entries = [];

    for (var i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== SIG_CD) break;
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commentLen = dv.getUint16(p + 32, true);
      var method = dv.getUint16(p + 10, true);
      var compSize = dv.getUint32(p + 20, true);
      var localOffset = dv.getUint32(p + 42, true);
      var name = decodeName(new Uint8Array(buffer, p + 46, nameLen));

      entries.push({
        name: name,
        method: method,
        compSize: compSize,
        offset: localOffset
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  /* 解压整个 ZIP，返回 Map<name, Uint8Array> */
  function unzipAll(buffer) {
    var dv = new DataView(buffer);
    var entries = listEntries(buffer);
    var result = {};
    return entries.reduce(function (chain, e) {
      return chain.then(function () {
        return inflateEntry(dv, e.offset, e.method, e.compSize).then(function (bytes) {
          result[e.name] = bytes;
        }).catch(function (err) {
          // 单条失败不阻断整体，记下来
          result[e.name] = null;
          if (!result.__error) result.__error = err.message;
        });
      });
    }, Promise.resolve()).then(function () {
      return result;
    });
  }

  function readJson(map, name) {
    var bytes = map[name];
    if (!bytes) return null;
    try {
      return JSON.parse(new TextDecoder("utf-8").decode(bytes));
    } catch (e) {
      return null;
    }
  }

  /* 从消息树里选出当前分支（根 → current_message_id，缺失时取最大 id） */
  function pickBranch(file) {
    var byId = {};
    var newest = null;
    var list = Array.isArray(file.messages) ? file.messages : [];

    list.forEach(function (m) {
      if (!m || typeof m.id !== "number") return;
      byId[m.id] = m;
      if (!newest || m.id > newest.id) newest = m;
    });
    if (!newest) return [];

    var cur = (file.current_message_id === null || file.current_message_id === undefined)
      ? null : byId[file.current_message_id];
    var chain = [];
    var node = cur || newest;
    var guard = 0;

    while (node && guard++ < 10000) {
      chain.push(node);
      if (node.parent_id === null || node.parent_id === undefined) break;
      node = byId[node.parent_id];
      if (!node) break;
    }
    return chain.reverse();
  }

  /* 把一次导出的会话文件转成 DeepFish 的消息数组 */
  function convertSession(file) {
    var chain = pickBranch(file);
    var msgs = [];

    for (var i = 0; i < chain.length; i++) {
      var m = chain[i];
      if (!m || m.role !== "USER") continue;

      var next = chain[i + 1];
      var reply = (next && next.role === "ASSISTANT") ? next : null;
      if (reply) i++;

      // 被内容过滤撤回的问答整轮跳过
      if (reply && reply.status === "CONTENT_FILTER") continue;

      var text = "";
      var fileCards = [];
      (m.fragments || []).forEach(function (f) {
        if (!f || !f.type) return;
        if (f.type === "REQUEST") {
          text += (text ? "\n" : "") + String(f.content || "");
        } else if (f.type === "FILE") {
          (f.files || []).forEach(function (x) {
            if (!x) return;
            fileCards.push({
              name: x.file_name || "文件",
              size: x.file_size || 0,
              isImage: !!x.is_image
            });
          });
        }
      });

      if (!text && !fileCards.length) continue;

      msgs.push({
        role: "user",
        content: text,
        fileNames: fileCards.map(function (c) { return c.name; })
      });

      if (reply) {
        var content = "";
        var reasoning = "";
        (reply.fragments || []).forEach(function (f) {
          if (!f || !f.type) return;
          if (f.type === "THINK") {
            if (f.content) reasoning += String(f.content) + "\n\n";
          } else if (f.type === "RESPONSE") {
            if (f.content) content += String(f.content);
          }
        });
        if (content || reasoning) {
          msgs.push({
            role: "assistant",
            content: content,
            reasoning: reasoning.trim()
          });
        }
      }
    }
    return msgs;
  }

  /* 解析整个导出包，返回对话列表（按更新时间倒序）
     只解压需要的 JSON 条目，跳过图片等大文件，避免内存爆掉。 */
  function parseExport(buffer, limit) {
    var max = limit || 300;
    var dv = new DataView(buffer);
    var entries = listEntries(buffer);

    var byName = {};
    entries.forEach(function (e) { byName[e.name] = e; });

    function readJson(name) {
      var e = byName[name];
      if (!e) return Promise.resolve(null);
      return inflateEntry(dv, e.offset, e.method, e.compSize).then(function (bytes) {
        try {
          return JSON.parse(new TextDecoder("utf-8").decode(bytes));
        } catch (err) {
          return null;
        }
      });
    }

    return readJson("manifest.json").then(function (manifest) {
      if (!manifest) throw new Error("压缩包里找不到 manifest.json，可能不是 DeepSeek 导出的文件");
      return readJson("chat_session_index.json").then(function (index) {
        if (!Array.isArray(index)) throw new Error("压缩包里找不到 chat_session_index.json");

        index.sort(function (a, b) {
          var ta = Date.parse((a && a.updated_at) || (a && a.inserted_at) || 0) || 0;
          var tb = Date.parse((b && b.updated_at) || (b && b.inserted_at) || 0) || 0;
          return tb - ta;
        });

        var picked = index.slice(0, max);
        var conversations = [];
        var skipped = 0;

        return picked.reduce(function (chain, row) {
          return chain.then(function () {
            if (!row || !row.id) { skipped++; return; }
            return readJson("chat_sessions/" + row.id + ".json").then(function (f) {
              if (!f) { skipped++; return; }
              var msgs = convertSession(f);
              if (!msgs.length) { skipped++; return; }
              conversations.push({
                id: f.id || row.id,
                title: String(f.title || "").trim() || "未命名对话",
                updatedAt: Date.parse(row.updated_at || f.inserted_at || 0) || Date.now(),
                messages: msgs
              });
            }).catch(function () { skipped++; });
          });
        }, Promise.resolve()).then(function () {
          return {
            formatVersion: manifest.export_format_version,
            total: index.length,
            conversations: conversations,
            skipped: skipped,
            truncated: index.length > picked.length
          };
        });
      });
    });
  }

  global.DSZip = {
    parseExport: parseExport,
    convertSession: convertSession,
    unzipAll: unzipAll,
    listEntries: listEntries
  };
})(window);
