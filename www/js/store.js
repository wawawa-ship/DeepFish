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
      // 长期记忆：自动整理的对话摘要 + 用户补充，超出窗口后靠它保住人设
      memory: typeof s.memory === "string" ? s.memory : "",
      // 已经压缩到第几条消息（下次从这里接着往后续写记忆）
      memoryCovered: typeof s.memoryCovered === "number" ? s.memoryCovered : 0,
      messages: msgs.map(function (m) {
        return {
          id: m.id || uid("m"),
          role: m.role === "assistant" ? "assistant" : (m.role === "system" ? "system" : "user"),
          content: typeof m.content === "string" ? m.content : "",
          reasoning: typeof m.reasoning === "string" ? m.reasoning : "",
          model: m.model || "",
          createdAt: m.createdAt || Date.now(),
          error: !!m.error,
          duration: typeof m.duration === "number" ? m.duration : 0,
          // 附件与引用
          images: Array.isArray(m.images) ? m.images : [],
          files: Array.isArray(m.files) ? m.files : [],
          citations: Array.isArray(m.citations) ? m.citations : [],
          // 本次回复的用量与费用（重启后仍可见）
          cost: (m.cost && typeof m.cost === "object") ? {
            cny: Number(m.cost.cny) || 0,
            peak: !!m.cost.peak,
            hit: Number(m.cost.hit) || 0,
            miss: Number(m.cost.miss) || 0,
            out: Number(m.cost.out) || 0,
            searches: Number(m.cost.searches) || 0,
            fetches: Number(m.cost.fetches) || 0
          } : null
        };
      })
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
    clearAll: clearAll,
    createSnapshot: createSnapshot,
    listSnapshots: listSnapshots,
    restoreSnapshot: restoreSnapshot,
    isFallback: function () { return useFallback; }
  };

  global.Store = store;
})(window);
