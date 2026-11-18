/* ==========================================================================
   存储层：IndexedDB 为主，localStorage 兜底
   - state 整体持久化（设置 + 全部会话）
   - 自动快照（最多 7 份），用于误删恢复
   - 备份文件导入 / 导出（跨版本升级保留数据）
   ========================================================================== */
(function (global) {
  "use strict";

  var DB_NAME = "xiaolan-db";
  var DB_VER = 1;
  var STORE = "kv";
  var KEY_STATE = "state";
  var SNAP_PREFIX = "snap:";
  var MAX_SNAPS = 7;
  var SNAP_INTERVAL = 8 * 60 * 1000;

  var SCHEMA_VERSION = 2;

  var db = null;
  var useFallback = false;
  var memFallback = {};
  var lastSnapAt = 0;
  var saveTimer = null;
  var pendingSave = null;

  /* -------------------- 基础工具 -------------------- */
  function uid(prefix) {
    return (prefix || "id") + "_" + Date.now().toString(36) +
      Math.random().toString(36).slice(2, 7);
  }

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function byteLen(str) {
    try { return new Blob([str]).size; } catch (e) { return str.length * 2; }
  }

  /* -------------------- IndexedDB -------------------- */
  function openDB() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined") return reject(new Error("no-idb"));
      var req;
      try {
        req = indexedDB.open(DB_NAME, DB_VER);
      } catch (e) {
        return reject(e);
      }
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("idb-open-failed")); };
      req.onblocked = function () { reject(new Error("idb-blocked")); };
    });
  }

  function idbTx(mode, fn) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, mode);
      var store = tx.objectStore(STORE);
      var out;
      try { out = fn(store); } catch (e) { return reject(e); }
      tx.oncomplete = function () { resolve(out && out.__req ? out.value : out); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error("tx-abort")); };
    });
  }

  function idbGet(key) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, "readonly");
      var r = tx.objectStore(STORE).get(key);
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  function idbSet(key, val) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error("tx-abort")); };
    });
  }

  function idbDel(key) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function idbKeys() {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, "readonly");
      var r = tx.objectStore(STORE).getAllKeys();
      r.onsuccess = function () { resolve(r.result || []); };
      r.onerror = function () { reject(r.error); };
    });
  }

  /* -------------------- 兜底存储 -------------------- */
  function fbGet(key) {
    try {
      var raw = localStorage.getItem("xiaolan:" + key);
      return raw == null ? undefined : JSON.parse(raw);
    } catch (e) { return memFallback[key]; }
  }
  function fbSet(key, val) {
    try {
      localStorage.setItem("xiaolan:" + key, JSON.stringify(val));
      return true;
    } catch (e) {
      memFallback[key] = val;
      return false;
    }
  }
  function fbDel(key) {
    try { localStorage.removeItem("xiaolan:" + key); } catch (e) {}
    delete memFallback[key];
  }
  function fbKeys() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("xiaolan:") === 0) out.push(k.slice(8));
      }
    } catch (e) {
      out = Object.keys(memFallback);
    }
    return out;
  }

  function get(key) {
    return useFallback ? Promise.resolve(fbGet(key)) : idbGet(key);
  }
  function set(key, val) {
    return useFallback ? Promise.resolve(fbSet(key, val)) : idbSet(key, val);
  }
  function del(key) {
    return useFallback ? Promise.resolve(fbDel(key)) : idbDel(key);
  }
  function keys() {
    return useFallback ? Promise.resolve(fbKeys()) : idbKeys();
  }

  /* -------------------- 默认状态 -------------------- */
  function defaultSettings() {
    return {
      apiKey: "",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash",
      // 新对话继承的默认角色
      defaultPersona: { name: "DeepFish", prompt: "", avatar: "" },
      // 新对话继承的默认生成开关
      defaultChat: { thinking: false, webSearch: false },
      ttsVoice: "tide",
      autoRead: false,
      autoMemory: true,
      // 是否把「现在几点几分」也告诉模型（会让 system 变化，影响缓存命中）
      showClock: false,
      agreedNotice: false,
      temperature: 1.0,
      maxTokens: 0,
      contextLimit: 100,
      // 上下文预算（单位：字）。按 token 估算动态决定发多少，而不是数条数。
      contextBudget: 120000,
      theme: "auto",
      fontSize: "normal",
      autoSnapshot: true,
      stream: true
    };
  }

  function defaultState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      settings: defaultSettings(),
      sessions: [],
      activeId: null
    };
  }

  /* -------------------- 迁移 -------------------- */
  function migrate(st) {
    if (!st || typeof st !== "object") return defaultState();
    var out = defaultState();

    // 设置合并（保留新增字段的默认值）
    if (st.settings && typeof st.settings === "object") {
      var ks = Object.keys(out.settings);
      for (var i = 0; i < ks.length; i++) {
        var k = ks[i];
        if (typeof st.settings[k] !== "undefined") out.settings[k] = st.settings[k];
      }
      // 兼容：早期可能叫 key / api_key
      if (!out.settings.apiKey) {
        out.settings.apiKey = st.settings.api_key || st.settings.key || "";
      }
    }

    // 角色默认值：优先用 defaultPersona，没有则回退到旧版的全局 systemPrompt
    var dp = (st.settings && st.settings.defaultPersona) || null;
    var legacySys = (st.settings && typeof st.settings.systemPrompt === "string")
      ? st.settings.systemPrompt : "";
    out.settings.defaultPersona = {
      name: (dp && typeof dp.name === "string" && dp.name) || "DeepFish",
      prompt: (dp && typeof dp.prompt === "string" && dp.prompt) ? dp.prompt : legacySys,
      avatar: (dp && typeof dp.avatar === "string") ? dp.avatar : ""
    };

    // 新对话默认开关（深拷贝，避免共享引用）
    var dc = (st.settings && st.settings.defaultChat) || {};
    out.settings.defaultChat = {
      thinking: !!dc.thinking,
      webSearch: !!dc.webSearch
    };

    // 只保留男声「暗潮」
    out.settings.ttsVoice = "tide";

    // 会话
    if (Array.isArray(st.sessions)) {
      // 旧版本只有一个全局 systemPrompt，迁移时把它写进每个旧对话
      var legacySys = (st.settings && typeof st.settings.systemPrompt === "string")
        ? st.settings.systemPrompt : "";
      out.sessions = st.sessions.map(function (s) {
        var ns = normalizeSession(s);
        if (ns) {
          if (!ns.persona.prompt && legacySys) ns.persona.prompt = legacySys;
          if (!ns.persona.name) ns.persona.name = out.settings.defaultPersona.name;
        }
        return ns;
      }).filter(Boolean);
    }

    out.activeId = st.activeId || (out.sessions[0] && out.sessions[0].id) || null;
    out.schemaVersion = SCHEMA_VERSION;
    return out;
  }

  /* ==================================================================
     消息结构：一个「回合」= 用户输入（最多 6 个变体）+ 每个变体下的
     模型输出（最多 6 个变体）。这样 6×6 = 36 种组合都能回看。
     ================================================================== */
  var MAX_VARIANTS = 6;

  function normalizeReply(r) {
    return {
      id: r.id || uid("r"),
      content: typeof r.content === "string" ? r.content : "",
      reasoning: typeof r.reasoning === "string" ? r.reasoning : "",
      model: r.model || "",
      createdAt: r.createdAt || Date.now(),
      error: !!r.error,
      duration: typeof r.duration === "number" ? r.duration : 0,
      citations: Array.isArray(r.citations) ? r.citations : [],
      usage: r.usage || null,
      cost: (r.cost && typeof r.cost === "object") ? {
        cny: Number(r.cost.cny) || 0,
        peak: !!r.cost.peak,
        hit: Number(r.cost.hit) || 0,
        miss: Number(r.cost.miss) || 0,
        out: Number(r.cost.out) || 0,
        searches: Number(r.cost.searches) || 0,
        fetches: Number(r.cost.fetches) || 0
      } : null
    };
  }

  function normalizeEdit(e) {
    var replies = Array.isArray(e.replies)
      ? e.replies.filter(Boolean).slice(0, MAX_VARIANTS).map(normalizeReply)
      : [];
    if (!replies.length) replies = [normalizeReply({})];

    var ai = parseInt(e.activeReply, 10);
    if (!(ai >= 0 && ai < replies.length)) ai = replies.length - 1;

    return {
      id: e.id || uid("e"),
      text: typeof e.text === "string" ? e.text : "",
      createdAt: e.createdAt || Date.now(),
      images: Array.isArray(e.images) ? e.images : [],
      files: Array.isArray(e.files) ? e.files : [],
      replies: replies,
      activeReply: ai
    };
  }

  function normalizeTurn(t) {
    var edits = Array.isArray(t.edits) && t.edits.length
      ? t.edits.filter(Boolean).slice(0, MAX_VARIANTS).map(normalizeEdit)
      : [normalizeEdit({})];

    var ae = parseInt(t.activeEdit, 10);
    if (!(ae >= 0 && ae < edits.length)) ae = edits.length - 1;

    // branch：这条消息挂在「哪条消息的哪个输入版本 + 哪个回复版本」下面。
    // 切换输入版本或切换回复版本后，挂在不活跃版本上的后续消息会自动隐藏（不删除）。
    var branch = null;
    if (t.branch && typeof t.branch.turnId === "string") {
      branch = {
        turnId: t.branch.turnId,
        editIndex: parseInt(t.branch.editIndex, 10) || 0,
        // null 表示老数据不校验回复版本
        replyIndex: (t.branch.replyIndex === null || t.branch.replyIndex === undefined)
          ? null
          : (parseInt(t.branch.replyIndex, 10) || 0)
      };
    }

    return {
      id: t.id || uid("u"),
      role: "user",
      createdAt: t.createdAt || Date.now(),
      edits: edits,
      activeEdit: ae,
      branch: branch
    };
  }

  /* 当前真正要显示 / 发送的回合：沿 branch 链检查父节点的输入版本是否被选中 */
  function visibleTurns(session) {
    var all = (session && session.messages) || [];
    if (!all.length) return [];

    // 老数据没有 branch，全部可见
    var hasBranch = false;
    for (var k = 0; k < all.length; k++) {
      if (all[k] && all[k].branch) { hasBranch = true; break; }
    }
    if (!hasBranch) return all.slice();

    var byId = {};
    for (var i = 0; i < all.length; i++) byId[all[i].id] = all[i];

    /* 按数组顺序逐个判定：branch 总是指向更早的回合，
       所以父节点的结果一定已经算好了，直接复用即可。
       这样没有递归、也没有深度上限——几千轮的对话照样正确。 */
    var okMap = {};

    function parentOk(turn) {
      var b = turn.branch;
      if (!b) return true;

      var parent = byId[b.turnId];
      if (!parent) return false;

      if ((parent.activeEdit || 0) !== (b.editIndex || 0)) return false;

      if (b.replyIndex !== null && b.replyIndex !== undefined) {
        var pe = parent.edits[parent.activeEdit || 0];
        if (pe && (pe.activeReply || 0) !== b.replyIndex) return false;
      }

      return okMap[parent.id] === true;
    }

    var out = [];
    for (var j = 0; j < all.length; j++) {
      var t = all[j];
      if (!t) continue;

      var ok;
      if (!t.branch) {
        ok = true;
      } else if (okMap[t.branch.turnId] === undefined && byId[t.branch.turnId]) {
        // 极端情况：父节点排在后面（数据乱序），退回逐级向上检查
        ok = (function () {
          var node = t;
          var seen = {};
          var guard = 0;
          while (node && node.branch) {
            if (++guard > 200000) return false;
            if (seen[node.id]) return false;
            seen[node.id] = 1;

            var p = byId[node.branch.turnId];
            if (!p) return false;
            if ((p.activeEdit || 0) !== (node.branch.editIndex || 0)) return false;

            var pe2 = p.edits[p.activeEdit || 0];
            if (node.branch.replyIndex !== null && node.branch.replyIndex !== undefined) {
              if (pe2 && (pe2.activeReply || 0) !== node.branch.replyIndex) return false;
            }
            node = p;
          }
          return true;
        })();
      } else {
        ok = parentOk(t);
      }

      okMap[t.id] = ok;
      if (ok) out.push(t);
    }

    return out;
  }

  /* 把旧的扁平 user/assistant 列表迁移成新结构；新结构原样保留 */
  function normalizeMessages(list) {
    var out = [];
    var cur = null;

    (Array.isArray(list) ? list : []).forEach(function (m) {
      if (!m) return;

      if (m.edits && Array.isArray(m.edits)) {
        cur = normalizeTurn(m);
        out.push(cur);
        return;
      }

      if (m.role === "assistant") {
        if (!cur) return;
        var edit = cur.edits[cur.edits.length - 1];
        // 占位的那条空回复直接替换
        if (edit.replies.length === 1 && !edit.replies[0].content && !edit.replies[0].error) {
          edit.replies[0] = normalizeReply(m);
        } else {
          edit.replies.push(normalizeReply(m));
        }
        edit.activeReply = edit.replies.length - 1;
        return;
      }

      if (m.role === "system") return;

      cur = {
        id: m.id || uid("u"),
        role: "user",
        createdAt: m.createdAt || Date.now(),
        activeEdit: 0,
        edits: [{
          id: uid("e"),
          text: typeof m.content === "string" ? m.content : "",
          createdAt: m.createdAt || Date.now(),
          images: Array.isArray(m.images) ? m.images : [],
          files: Array.isArray(m.files) ? m.files : [],
          replies: [normalizeReply({})],
          activeReply: 0
        }]
      };
      out.push(cur);
    });

    // 老数据没有 branch，按顺序串成一条链，这样修改历史输入时后续才能正确隐藏
    for (var b = 1; b < out.length; b++) {
      if (!out[b].branch && out[b - 1]) {
        var prevTurn = out[b - 1];
        var prevEdit = prevTurn.edits[prevTurn.activeEdit || 0];
        out[b].branch = {
          turnId: prevTurn.id,
          editIndex: prevTurn.activeEdit || 0,
          replyIndex: prevEdit ? (prevEdit.activeReply || 0) : 0
        };
      }
    }

    return out;
  }

  function normalizeSession(s) {
    if (!s || typeof s !== "object") return null;
    var msgs = Array.isArray(s.messages) ? s.messages : [];
    var p = (s.persona && typeof s.persona === "object") ? s.persona : {};
    var cs = (s.settings && typeof s.settings === "object") ? s.settings : {};
    return {
      id: s.id || uid("s"),
      title: s.title || "新对话",
      createdAt: s.createdAt || Date.now(),
      updatedAt: s.updatedAt || s.createdAt || Date.now(),
      pinned: !!s.pinned,
      // 每个对话有独立的角色：名字 / 设定 / 头像（空字符串表示跟随默认）
      persona: {
        name: typeof p.name === "string" ? p.name : "",
        prompt: typeof p.prompt === "string" ? p.prompt : "",
        avatar: typeof p.avatar === "string" ? p.avatar : ""
      },
      // 每个对话独立的生成开关、模型与背景
      chat: {
        thinking: !!cs.thinking,
        webSearch: !!cs.webSearch,
        model: typeof cs.model === "string" ? cs.model : ""
      },
      background: typeof s.background === "string" ? s.background : "",
      // 输入框草稿：切换对话时各自保留，不会串到别的对话
      draft: typeof s.draft === "string" ? s.draft : "",
      // 草稿里还没发出去的图片 / 文件
      draftAttachments: Array.isArray(s.draftAttachments) ? s.draftAttachments : [],
      // 长期记忆：自动整理的对话摘要 + 用户补充，超出窗口后靠它保住人设
      memory: typeof s.memory === "string" ? s.memory : "",
      // 已经压缩到第几条消息（下次从这里接着往后续写记忆）
      memoryCovered: typeof s.memoryCovered === "number" ? s.memoryCovered : 0,
      messages: normalizeMessages(msgs)
    };
  }

  /* -------------------- 初始化 -------------------- */
  function init() {
    return openDB().then(function (d) {
      db = d;
      return get(KEY_STATE);
    }).then(function (raw) {
      return { raw: raw, fallback: false };
    }).catch(function () {
      useFallback = true;
      return get(KEY_STATE).then(function (raw) {
        return { raw: raw, fallback: true };
      });
    }).then(function (res) {
      var st;
      if (res.raw && typeof res.raw === "object") {
        st = migrate(res.raw);
      } else if (typeof res.raw === "string") {
        try { st = migrate(JSON.parse(res.raw)); } catch (e) { st = defaultState(); }
      } else {
        st = defaultState();
      }
      store.state = st;
      if (res.fallback) {
        // 把兜底数据回写一次，确认持久化能力
        set(KEY_STATE, st);
      }
      return st;
    });
  }

  /* -------------------- 保存（防抖） -------------------- */
  function saveNow() {
    if (!store.state) return Promise.resolve(false);
    var snapshot = store.state;
    return set(KEY_STATE, snapshot).then(function () {
      return true;
    }).catch(function (err) {
      // 配额超限等：尝试降级到 localStorage
      if (!useFallback) {
        useFallback = true;
        return set(KEY_STATE, snapshot).catch(function () { return false; });
      }
      return false;
    });
  }

  function save() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      saveNow();
    }, 220);
  }

  function saveImmediate() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    return saveNow();
  }

  /* -------------------- 快照 -------------------- */
  function snapKey(ts) { return SNAP_PREFIX + ts; }

  function createSnapshot(force) {
    if (!store.state) return Promise.resolve(null);
    if (!force && !store.state.settings.autoSnapshot) return Promise.resolve(null);
    var now = Date.now();
    if (!force && now - lastSnapAt < SNAP_INTERVAL) return Promise.resolve(null);
    lastSnapAt = now;

    var payload = clone(store.state);
    return set(snapKey(now), payload).then(function () {
      return keys();
    }).then(function (all) {
      var snaps = all.filter(function (k) {
        return typeof k === "string" && k.indexOf(SNAP_PREFIX) === 0;
      }).sort();
      var extra = snaps.length - MAX_SNAPS;
      if (extra > 0) {
        var toDel = snaps.slice(0, extra);
        return Promise.all(toDel.map(function (k) { return del(k); }));
      }
      return null;
    }).then(function () {
      return now;
    }).catch(function () { return null; });
  }

  function listSnapshots() {
    return keys().then(function (all) {
      return all.filter(function (k) {
        return typeof k === "string" && k.indexOf(SNAP_PREFIX) === 0;
      }).map(function (k) {
        return { key: k, ts: parseInt(k.slice(SNAP_PREFIX.length), 10) };
      }).sort(function (a, b) { return b.ts - a.ts; });
    }).catch(function () { return []; });
  }

  function restoreSnapshot(key) {
    return get(key).then(function (val) {
      if (!val) throw new Error("快照不存在");
      store.state = migrate(val);
      return saveImmediate().then(function () { return store.state; });
    });
  }

  /* -------------------- 统计 -------------------- */
  function stats() {
    var st = store.state || defaultState();
    var msgCount = 0;
    for (var i = 0; i < st.sessions.length; i++) msgCount += st.sessions[i].messages.length;
    var size = 0;
    try { size = byteLen(JSON.stringify(st)); } catch (e) { size = 0; }
    return { sessions: st.sessions.length, messages: msgCount, bytes: size };
  }

  /* -------------------- 导出 / 导入 -------------------- */
  function buildExport(includeKey) {
    var st = clone(store.state || defaultState());
    if (!includeKey) st.settings.apiKey = "";
    return {
      app: "xiaolan-deepseek",
      schemaVersion: SCHEMA_VERSION,
      appVersion: global.APP_VERSION || "1.0.0",
      exportedAt: new Date().toISOString(),
      settings: st.settings,
      sessions: st.sessions,
      activeId: st.activeId
    };
  }

  function exportFile(includeKey) {
    var data = buildExport(includeKey);
    var json = JSON.stringify(data, null, 2);
    var d = new Date();
    function p(n) { return n < 10 ? "0" + n : "" + n; }
    var name = "xiaolan-backup-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      "-" + p(d.getHours()) + p(d.getMinutes()) + ".json";
    return { name: name, json: json, size: byteLen(json) };
  }

  function importData(obj, mode) {
    if (!obj || typeof obj !== "object") throw new Error("文件格式不正确");
    var incoming = null;

    if (Array.isArray(obj.sessions)) {
      incoming = migrate({
        settings: obj.settings,
        sessions: obj.sessions,
        activeId: obj.activeId
      });
    } else if (Array.isArray(obj.conversations)) {
      // 极宽松兼容
      incoming = migrate({
        settings: obj.settings || obj.config,
        sessions: obj.conversations,
        activeId: obj.activeId
      });
    } else {
      throw new Error("未找到对话数据（缺少 sessions 字段）");
    }

    var st = store.state || defaultState();
    var report = { added: 0, updated: 0, total: 0 };

    if (mode === "replace") {
      st.sessions = incoming.sessions;
      st.activeId = incoming.activeId;
      if (incoming.settings) {
        // 保留本机 API Key（若备份里没有）
        var keepKey = st.settings.apiKey;
        st.settings = incoming.settings;
        if (!st.settings.apiKey && keepKey) st.settings.apiKey = keepKey;
      }
      report.added = incoming.sessions.length;
    } else {
      var map = {};
      st.sessions.forEach(function (s) { map[s.id] = s; });
      incoming.sessions.forEach(function (s) {
        if (map[s.id]) {
          // 保留消息较多的版本
          if (s.messages.length >= map[s.id].messages.length) {
            map[s.id] = s;
            report.updated++;
          }
        } else {
          map[s.id] = s;
          report.added++;
        }
      });
      st.sessions = Object.keys(map).map(function (k) { return map[k]; });
      // 若本机没有 API Key，则采用备份中的
      if (!st.settings.apiKey && incoming.settings && incoming.settings.apiKey) {
        st.settings.apiKey = incoming.settings.apiKey;
      }
      if (!st.activeId && st.sessions.length) st.activeId = st.sessions[0].id;
    }

    st.sessions.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    report.total = st.sessions.length;
    store.state = st;
    return saveImmediate().then(function () { return report; });
  }

  /* -------------------- 清空 -------------------- */
  function clearAll() {
    store.state = defaultState();
    return saveImmediate().then(function () {
      return keys();
    }).then(function (all) {
      var snaps = all.filter(function (k) {
        return typeof k === "string" && k.indexOf(SNAP_PREFIX) === 0;
      });
      return Promise.all(snaps.map(function (k) { return del(k); }));
    }).then(function () { return true; });
  }

  /* -------------------- 导出对象 -------------------- */
  var store = {
    state: null,
    ready: false,
    init: init,
    save: save,
    saveImmediate: saveImmediate,
    uid: uid,
    clone: clone,
    defaultSettings: defaultSettings,
    defaultState: defaultState,
    normalizeSession: normalizeSession,
    stats: stats,
    exportFile: exportFile,
    buildExport: buildExport,
    importData: importData,
    visibleTurns: visibleTurns,
    clearAll: clearAll,
    createSnapshot: createSnapshot,
    listSnapshots: listSnapshots,
    restoreSnapshot: restoreSnapshot,
    isFallback: function () { return useFallback; }
  };

  global.Store = store;
})(window);
