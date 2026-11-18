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

  /* ---------- 片段抽取 ---------- */
  function userTextOf(m) {
    var text = "";
    var names = [];
    (m.fragments || []).forEach(function (f) {
      if (!f || !f.type) return;
      if (f.type === "REQUEST") {
        text += (text ? "\n" : "") + String(f.content || "");
      } else if (f.type === "FILE") {
        (f.files || []).forEach(function (x) {
          if (!x) return;
          names.push(x.file_name || "文件");
        });
      }
    });
    return { text: text, names: names };
  }

  function replyOf(m) {
    var content = "";
    var reasoning = "";
    (m.fragments || []).forEach(function (f) {
      if (!f || !f.type) return;
      if (f.type === "THINK") {
        if (f.content) reasoning += String(f.content) + "\n\n";
      } else if (f.type === "RESPONSE" || f.type === "TEMPLATE_RESPONSE") {
        if (f.content) content += String(f.content);
      }
    });
    return { content: content, reasoning: reasoning.trim() };
  }

  /* 把一次导出的会话文件转成 DeepFish 的「回合 + 变体」结构。
     不再是只取当前分支，而是把整棵树展开：
       · 同一位置有多个用户输入 → 变成该回合的多个 edits
       · 同一个输入有多条模型回复 → 变成该输入的多个 replies
       · 每个回复下面的后续对话 → 通过 branch 挂到对应的 (回合, 输入, 回复) 上 */
  function convertSession(file) {
    var list = Array.isArray(file.messages) ? file.messages : [];
    var byId = {};
    var children = {};
    var roots = [];
    var flat = [];   // 仅用于「共多少条」的预览展示

    list.forEach(function (m) {
      if (!m || typeof m.id !== "number") return;
      byId[m.id] = m;
    });

    list.forEach(function (m) {
      if (!m || typeof m.id !== "number") return;
      var pid = m.parent_id;
      if (pid === null || pid === undefined || !byId[pid]) roots.push(m);
      else (children[pid] = children[pid] || []).push(m);
    });

    if (!roots.length) return { turns: [], count: 0 };

    // 当前路径上的节点排在前面，导入后默认看到的就是官方 App 里那一条
    var onPath = {};
    var walk = byId[file.current_message_id];
    var guard = 0;
    while (walk && guard++ < 10000) {
      onPath[walk.id] = true;
      walk = (walk.parent_id === null || walk.parent_id === undefined) ? null : byId[walk.parent_id];
    }

    function pathFirst(arr) {
      return arr.slice().sort(function (a, b) {
        var pa = onPath[a.id] ? 0 : 1;
        var pb = onPath[b.id] ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return (a.id || 0) - (b.id || 0);
      });
    }

    var turns = [];

    /* 用显式栈做深度优先遍历，不用递归——
       超长对话可能有上千层，递归会爆栈，整段就导不进来了。 */
    var stack = [];

    var rootUsers = pathFirst(roots.filter(function (m) { return m && m.role === "USER"; }));
    if (rootUsers.length) stack.push({ users: rootUsers, parent: null });

    while (stack.length) {
      var frame = stack.pop();
      var userNodes = frame.users;
      var parentRef = frame.parent;
      if (!userNodes || !userNodes.length) continue;

      var edits = userNodes.map(function (un) {
        var u = userTextOf(un);
        var ais = pathFirst((children[un.id] || []).filter(function (x) {
          return x && x.role === "ASSISTANT";
        }));

        var replies = ais.map(function (an) {
          var r = replyOf(an);
          return { node: an, content: r.content, reasoning: r.reasoning };
        });

        return { node: un, text: u.text, names: u.names, replies: replies };
      });

      // 用户文字和回复全空的回合没意义
      edits = edits.filter(function (e) {
        if (e.text || e.names.length) return true;
        return e.replies.some(function (r) { return r.content || r.reasoning; });
      });
      if (!edits.length) continue;

      var turnId = "t_" + edits[0].node.id;
      turns.push({
        id: turnId,
        branch: parentRef ? {
          turnId: parentRef.turnId,
          editIndex: parentRef.editIndex,
          replyIndex: parentRef.replyIndex
        } : null,
        edits: edits
      });

      // 逆序压栈，保证出栈顺序和原来的递归一致（先第一个分支）
      for (var ei = edits.length - 1; ei >= 0; ei--) {
        var reps = edits[ei].replies;
        for (var ri = reps.length - 1; ri >= 0; ri--) {
          var kids = pathFirst((children[reps[ri].node.id] || []).filter(function (x) {
            return x && x.role === "USER";
          }));
          if (kids.length) {
            stack.push({
              users: kids,
              parent: { turnId: turnId, editIndex: ei, replyIndex: ri }
            });
          }
        }
      }
    }

    // 内容过滤撤回的整轮丢掉
    turns = turns.filter(function (t) {
      if (!t.edits.length) return false;
      return t.edits.some(function (e) {
        if (e.text || e.names.length) return true;
        return e.replies.some(function (r) { return r.content || r.reasoning; });
      });
    });

    var count = 0;
    turns.forEach(function (t) {
      t.edits.forEach(function (e) {
        count += 1 + Math.max(1, e.replies.length);
      });
    });

    return { turns: turns, count: count };
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
              var built = convertSession(f);
              if (!built || !built.turns.length) { skipped++; return; }
              conversations.push({
                id: f.id || row.id,
                title: String(f.title || "").trim() || "未命名对话",
                updatedAt: Date.parse(row.updated_at || f.inserted_at || 0) || Date.now(),
                turns: built.turns,
                count: built.count
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
