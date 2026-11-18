/* ==========================================================================
   DeepFish  —  主逻辑
   ========================================================================== */
(function () {
  "use strict";

  var AppVersion = "1.15.0";
  window.APP_VERSION = AppVersion;

  var $ = function (id) { return document.getElementById(id); };
  var state = null;
  var settings = null;

  var streaming = false;
  var controller = null;
  var lastUserText = "";
  var autoScroll = true;
  var $messages = $("messages");
  var $chat = $("chat");
  var $input = $("input");
  var $sendBtn = $("btnSend");
  var $stopBtn = $("btnStop");

  /* ==================================================================
     基础工具
     ================================================================== */
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  function clockText(ts) {
    var d = new Date(ts || Date.now());
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function dayLabel(ts) {
    var now = new Date();
    var d = new Date(ts);
    var t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var t1 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var diff = Math.round((t0 - t1) / 86400000);
    if (diff <= 0) return "今天";
    if (diff === 1) return "昨天";
    if (diff < 7) return diff + " 天前";
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }

  function esc(s) { return MD.escape(s); }

  function trimTitle(text) {
    var t = String(text || "").replace(/\s+/g, " ").trim();
    if (!t) return "新对话";
    return t.length > 24 ? t.slice(0, 24) + "…" : t;
  }

  /* 把 Markdown 去掉，得到用于列表预览的纯文本 */
  function plainPreview(text) {
    var t = String(text || "");
    if (!t) return "";
    t = t.replace(/```[\s\S]*?(```|$)/g, " [代码] ");
    t = t.replace(/`([^`]*)`/g, "$1");
    t = t.replace(/^#{1,6}\s+/gm, "");
    t = t.replace(/\*\*([^*]*)\*\*/g, "$1");
    t = t.replace(/__([^_]*)__/g, "$1");
    t = t.replace(/~~([^~]*)~~/g, "$1");
    t = t.replace(/(^|\s)\*([^*\n]+)\*/g, "$1$2");
    t = t.replace(/^\s*[-*+]\s+/gm, "");
    t = t.replace(/^\s*\d+[.)]\s+/gm, "");
    t = t.replace(/^\s*>\s?/gm, "");
    t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
    t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    t = t.replace(/\s+/g, " ").trim();
    return t;
  }

  /* ==================================================================
     角色（每个对话独立）
     ================================================================== */
  var DEFAULT_AVATAR = "icons/avatar-256.png";
  var DEFAULT_NAME = "DeepFish";

  function personaOf(session) {
    var d = (settings && settings.defaultPersona) || {};
    if (!session) {
      return {
        name: String(d.name || DEFAULT_NAME).trim() || DEFAULT_NAME,
        prompt: typeof d.prompt === "string" ? d.prompt : "",
        avatar: d.avatar || ""
      };
    }
    var p = session.persona || {};
    return {
      name: String(p.name || d.name || DEFAULT_NAME).trim() || DEFAULT_NAME,
      prompt: typeof p.prompt === "string" ? p.prompt : "",
      avatar: p.avatar || ""
    };
  }

  function avatarOf(p) {
    return (p && p.avatar) || DEFAULT_AVATAR;
  }

  /* 当前编辑目标：有会话就改会话，没有会话就改"新对话默认角色" */
  function personaTarget() {
    var s = getSession();
    if (s) {
      if (!s.persona) s.persona = { name: "", prompt: "", avatar: "" };
      return { session: s, persona: personaOf(s), isDefault: false };
    }
    return { session: null, persona: personaOf(null), isDefault: true };
  }

  /* ==================================================================
     用量与费用（官方价格，单位：元 / 百万 tokens）
     ================================================================== */
  var PRICING = {
    "deepseek-flash": {
      hit: { off: 0.02, peak: 0.04 },
      miss: { off: 1, peak: 2 },
      out: { off: 4, peak: 8 }
    },
    "deepseek-v4-pro": {
      hit: { off: 0.15, peak: 0.30 },
      miss: { off: 4.5, peak: 9 },
      out: { off: 13.5, peak: 27 }
    }
  };
  var DEFAULT_PRICE = PRICING["deepseek-flash"];
  var TOOL_PRICE = 0.005; // 每次搜索 / 抓取（5 元 / 1000 次）

  /* 高峰：北京时间周一至周五 9:00-12:00、14:00-18:00 */
  function isPeakTime(when) {
    var t = when ? new Date(when) : new Date();
    var utc = t.getTime() + t.getTimezoneOffset() * 60000;
    var bj = new Date(utc + 8 * 3600000);
    var day = bj.getDay();
    if (day === 0 || day === 6) return false;
    var h = bj.getHours();
    return (h >= 9 && h < 12) || (h >= 14 && h < 18);
  }

  function computeCost(model, usage, when) {
    var p = PRICING[model] || DEFAULT_PRICE;
    var peak = isPeakTime(when);
    var hit = usage.prompt_cache_hit_tokens || 0;
    var miss = usage.prompt_cache_miss_tokens;
    if (miss === undefined || miss === null) {
      miss = Math.max(0, (usage.prompt_tokens || 0) - hit);
    }
    var out = usage.completion_tokens || 0;

    var tools = usage.server_tool_use || {};
    var searches = (tools.tool_search || 0) + (tools.tool_image_search || 0);
    var fetches = tools.tool_fetch || 0;

    var cny =
      (hit / 1e6) * (peak ? p.hit.peak : p.hit.off) +
      (miss / 1e6) * (peak ? p.miss.peak : p.miss.off) +
      (out / 1e6) * (peak ? p.out.peak : p.out.off) +
      (searches + fetches) * TOOL_PRICE;

    return {
      cny: cny,
      peak: peak,
      hit: hit,
      miss: miss,
      out: out,
      searches: searches,
      fetches: fetches
    };
  }

  function fmtCny(v) {
    if (!v || isNaN(v)) return "¥0";
    if (v < 0.0001) return "¥" + v.toFixed(5);
    if (v < 0.01) return "¥" + v.toFixed(4);
    if (v < 1) return "¥" + v.toFixed(3);
    return "¥" + v.toFixed(2);
  }

  function fmtNum(n) {
    n = n || 0;
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function isNative() {
    return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" &&
      window.Capacitor.isNativePlatform());
  }

  /* ==================================================================
     Toast / Modal
     ================================================================== */
  var toastTimer = null;
  function toast(msg, ms) {
    var el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, ms || 2200);
  }

  var modalResolve = null;

  function openModal(opts) {
    var root = $("modal");
    var card = root.querySelector(".modal-card");
    $("modalTitle").textContent = opts.title || "";
    $("modalMsg").textContent = opts.message || "";

    var oldInput = card.querySelector(".modal-input");
    if (oldInput) oldInput.parentNode.removeChild(oldInput);

    var inputEl = null;
    if (opts.input) {
      inputEl = document.createElement("input");
      inputEl.type = "text";
      inputEl.className = "modal-input";
      inputEl.value = opts.value || "";
      inputEl.placeholder = opts.placeholder || "";
      inputEl.style.cssText =
        "width:100%;margin:0 0 16px;padding:10px 12px;border-radius:11px;" +
        "border:1px solid var(--line);background:var(--panel-2);color:var(--text);" +
        "font-size:14px;font-family:inherit;outline:none;";
      $("modalMsg").parentNode.insertBefore(inputEl, $("modalMsg").nextSibling);
    }

    $("modalOk").textContent = opts.okText || "确定";
    $("modalCancel").textContent = opts.cancelText || "取消";
    $("modalCancel").style.display = opts.hideCancel ? "none" : "";

    root.hidden = false;
    void root.offsetWidth;
    root.classList.add("show");

    return new Promise(function (resolve) {
      modalResolve = resolve;
      function cleanup(val) {
        root.classList.remove("show");
        setTimeout(function () { root.hidden = true; }, 200);
        modalResolve = null;
        resolve(val);
      }
      $("modalOk").onclick = function () {
        cleanup(inputEl ? inputEl.value : true);
      };
      $("modalCancel").onclick = function () { cleanup(null); };
      root.onclick = function (e) { if (e.target === root) cleanup(null); };
      if (inputEl) setTimeout(function () { inputEl.focus(); }, 220);
    });
  }

  function confirmDialog(title, message, okText) {
    return openModal({ title: title, message: message, okText: okText || "确定" });
  }

  /* 带输入框的弹窗：用于修改已发送的内容 */
  function openInputModal(title, value, message) {
    return openModal({
      title: title,
      message: message || "",
      input: true,
      value: value || "",
      okText: "保存",
      cancelText: "取消"
    });
  }

  /* ==================================================================
     外观
     ================================================================== */
  var mediaDark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function effectiveTheme() {
    if (settings.theme === "light") return "light";
    if (settings.theme === "dark") return "dark";
    return mediaDark && mediaDark.matches ? "dark" : "light";
  }

  function applyTheme() {
    var t = effectiveTheme();
    document.documentElement.setAttribute("data-theme", t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#0b1220" : "#f3f6fc");
  }

  function applyFont() {
    var map = { small: "14px", normal: "15px", large: "16.5px" };
    var key = (settings && settings.fontSize) || "normal";
    document.documentElement.style.setProperty("--fs", map[key] || "15px");
  }

  function updateViewport() {
    var dh = document.documentElement.clientHeight;
    var ih = window.innerHeight;
    var vv = (window.visualViewport && window.visualViewport.height) || 0;

    var h = dh || ih || 640;
    // 软键盘弹起时 visualViewport 更准确
    if (vv > 200 && vv < h - 60) h = vv;
    if (!h || h < 200) h = 640;

    document.documentElement.style.setProperty("--app-h", Math.round(h) + "px");
  }

  /* ==================================================================
     会话
     ================================================================== */
  function getSession() {
    if (!state.activeId) return null;
    for (var i = 0; i < state.sessions.length; i++) {
      if (state.sessions[i].id === state.activeId) return state.sessions[i];
    }
    return null;
  }

  function createSession() {
    var d = settings.defaultPersona || {};
    var dc = settings.defaultChat || {};
    var s = {
      id: Store.uid("s"),
      title: "新对话",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      // 新对话从"默认角色"继承一份独立副本
      persona: {
        name: String(d.name || DEFAULT_NAME).trim() || DEFAULT_NAME,
        prompt: d.prompt || "",
        avatar: d.avatar || ""
      },
      chat: {
        thinking: !!dc.thinking,
        webSearch: !!dc.webSearch,
        model: ""
      },
      background: "",
      messages: []
    };
    state.sessions.unshift(s);
    state.activeId = s.id;
    return s;
  }

  function sortedSessions() {
    return state.sessions.slice().sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  /* ==================================================================
     渲染：消息
     ================================================================== */
  function msgHeadHtml(role, msg) {
    if (role === "user") return "";
    var p = personaOf(getSession());
    return '<div class="msg-head">' +
      '<img src="' + esc(avatarOf(p)) + '" alt="">' +
      '<span class="who">' + esc(p.name) + '</span>' +
      '<span class="meta">' + clockText(msg.createdAt) + "</span>" +
      "</div>";
  }

  var ICON_COPY = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 011-1h10"/></svg>';
  var ICON_RETRY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 11-3.2-6.9M21 3v6h-6"/></svg>';
  var ICON_SPEAK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/></svg>';
  var ICON_DEL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>';
  var ICON_EDIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L18 10a2.8 2.8 0 10-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';

  function iconAct(act, turnId, icon, label, side) {
    return '<button class="act" type="button" data-act="' + act + '" data-turn="' + turnId +
      '" data-side="' + (side || "") + '" aria-label="' + label + '" title="' + label + '">' +
      icon + "</button>";
  }

  /* 变体切换：‹ 2/6 › */
  function variantNavHtml(turnId, side, index, total) {
    return '<div class="vnav">' +
      '<button type="button" class="vbtn" data-act="vprev" data-side="' + side +
      '" data-turn="' + turnId + '"' + (index <= 0 ? " disabled" : "") + ' aria-label="上一个版本">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>' +
      '<span class="vnum">' + (index + 1) + "/" + total + "</span>" +
      '<button type="button" class="vbtn" data-act="vnext" data-side="' + side +
      '" data-turn="' + turnId + '"' + (index >= total - 1 ? " disabled" : "") + ' aria-label="下一个版本">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>' +
      "</div>";
  }

  function userActionBtns(turn) {
    var id = turn.id;
    var html = "";
    html += iconAct("copy", id, ICON_COPY, "复制", "user");
    html += iconAct("editmsg", id, ICON_EDIT, "修改这句话", "user");
    html += iconAct("del", id, ICON_DEL, "删除", "user");
    return html;
  }

  function assistantActionBtns(turn, reply) {
    var id = turn.id;
    var html = "";
    html += iconAct("copy", id, ICON_COPY, "复制", "ai");
    html += iconAct("retry", id, ICON_RETRY, "重新生成", "ai");
    html += iconAct("speak", id, ICON_SPEAK, "朗读", "ai");
    if (reply && reply.cost) {
      html += '<button class="act usage-btn" type="button" data-act="usage" data-side="ai"' +
        ' data-turn="' + id + '" data-reply="' + reply.id + '" aria-label="查看用量">' +
        fmtCny(reply.cost.cny) + "</button>";
    }
    html += iconAct("del", id, ICON_DEL, "删除", "ai");
    return html;
  }

  /* 展开的用量明细 */
  function usageCardHtml(msg) {
    var c = msg.cost;
    if (!c) return "";
    var total = c.hit + c.miss;

    var html = '<div class="usage-card" data-for="' + msg.id + '" hidden>';
    html += '<div class="usage-row"><span>输入</span><b>' + fmtNum(total) + " tokens</b></div>";
    if (c.hit) {
      html += '<div class="usage-row dim"><span>其中缓存命中</span><b>' + fmtNum(c.hit) + "</b></div>";
    }
    html += '<div class="usage-row"><span>输出</span><b>' + fmtNum(c.out) + " tokens</b></div>";
    if (c.searches) {
      html += '<div class="usage-row"><span>联网搜索</span><b>' + c.searches + " 次</b></div>";
    }
    if (c.fetches) {
      html += '<div class="usage-row"><span>网页抓取</span><b>' + c.fetches + " 次</b></div>";
    }
    html += '<div class="usage-row total"><span>本次费用</span><b>' + fmtCny(c.cny) + "</b></div>";
    html += '<div class="usage-note">' + (c.peak ? "高峰时段" : "空闲时段") + "计价 · 按官方价格估算</div>";
    html += "</div>";
    return html;
  }

  /* 消息里的图片 / 文件 / 参考来源 */
  function attachHtml(msg) {
    var html = "";
    var imgs = msg.images || [];
    var files = msg.files || [];
    if (imgs.length) {
      html += '<div class="msg-images">';
      for (var i = 0; i < imgs.length; i++) {
        html += '<img src="' + esc(imgs[i]) + '" alt="">';
      }
      html += "</div>";
    }
    if (files.length) {
      html += '<div class="msg-files">';
      for (var k = 0; k < files.length; k++) {
        html += '<div class="msg-file"><svg viewBox="0 0 24 24" aria-hidden="true">' +
          '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/>' +
          '<path d="M14 3v5h5"/></svg><span>' + esc(files[k].name || "文件") + "</span></div>";
      }
      html += "</div>";
    }
    return html;
  }

  function sourcesHtml(msg) {
    var list = msg.citations || [];
    if (!list.length) return "";
    var html = '<div class="sources"><div class="sources-title">参考来源</div>';
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || !c.url) continue;
      html += '<a class="source" href="' + esc(c.url) + '" target="_blank" rel="noopener noreferrer">' +
        "<b>" + (i + 1) + "</b><span>" + esc(c.title || c.url) + "</span></a>";
    }
    return html + "</div>";
  }

  function reasoningHtml(msg) {
    if (!msg.reasoning) return "";
    return '<div class="reasoning" data-reasoning="' + msg.id + '">' +
      '<button class="reasoning-head" type="button">' +
      '<svg class="spark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>' +
      "<span>深度思考</span>" +
      '<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
      "</button>" +
      '<div class="reasoning-body">' + esc(msg.reasoning) + "</div>" +
      "</div>";
  }

  function userNode(turn) {
    var edit = turn.edits[turn.activeEdit] || turn.edits[0];
    var node = document.createElement("div");
    node.className = "msg user";
    node.setAttribute("data-turn", turn.id);

    var html = '<div class="bubble">' + attachHtml(edit) +
      (edit.text ? esc(edit.text) : "") + "</div>";

    html += '<div class="actions">';
    if (turn.edits.length > 1) {
      html += variantNavHtml(turn.id, "user", turn.activeEdit, turn.edits.length);
    }
    html += userActionBtns(turn);
    html += "</div>";

    node.innerHTML = html;
    return node;
  }

  function aiNode(turn, reply, opts) {
    var node = document.createElement("div");
    node.className = "msg ai";
    node.setAttribute("data-turn", turn.id);
    node.setAttribute("data-reply", reply.id);

    var streaming = !!(opts && opts.streaming);
    var html = msgHeadHtml("assistant", reply) + reasoningHtml(reply);

    if (reply.error) {
      html += '<div class="bubble"><div class="msg-error">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/>' +
        '<path d="M12 8v5M12 16.2v.1"/></svg><div>' + esc(reply.content) + "</div></div></div>";
    } else if (streaming) {
      html += '<div class="bubble"></div>';
    } else {
      var body = reply.content || "";
      if (body.length > 8000) {
        html += '<div class="bubble"><div class="stream-text">' + esc(body) + "</div>" +
          '<div class="long-note">内容较长（' + fmtNum(body.length) + " 字），已用纯文本显示以保持流畅</div></div>";
      } else {
        html += '<div class="bubble"><div class="md">' + MD.render(body) + "</div></div>";
      }
      html += sourcesHtml(reply);
    }

    if (!streaming) {
      var edit = turn.edits[turn.activeEdit] || turn.edits[0];
      html += '<div class="actions">';
      if (edit && edit.replies.length > 1) {
        html += variantNavHtml(turn.id, "ai", edit.activeReply, edit.replies.length);
      }
      html += assistantActionBtns(turn, reply);
      html += "</div>";
      html += usageCardHtml(reply);
    }
    node.innerHTML = html;
    return node;
  }

  /* 一个回合 = 用户气泡 + 该输入下当前选中的模型回复 */
  function turnNode(turn, opts) {
    var box = document.createElement("div");
    box.className = "turn-block";
    box.setAttribute("data-turn", turn.id);
    box.appendChild(userNode(turn));

    var edit = turn.edits[turn.activeEdit] || turn.edits[0];
    var reply = edit && (edit.replies[edit.activeReply] || edit.replies[0]);
    if (reply && (reply.content || reply.error || (opts && opts.streaming))) {
      box.appendChild(aiNode(turn, reply, opts));
    }
    return box;
  }

  var WELCOME_LINES = [
    "你好，我能帮什么忙吗？",
    "欢迎回来，想从哪里开始？",
    "你好，让我们开始聊天吧",
    "欢迎回来，随时开始吧"
  ];

  function welcomeHtml() {
    var p = personaOf(getSession());
    var line = WELCOME_LINES[Math.floor(Math.random() * WELCOME_LINES.length)];
    var html = '<div class="welcome">' +
      '<img class="welcome-avatar" src="' + esc(avatarOf(p)) + '" alt="">' +
      "<h2>" + line + "</h2>";

    if (!settings.apiKey) {
      html += '<button class="setup-tip" type="button" id="setupKey">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/>' +
        '<path d="M11 12l8-8M17 3l4 4M14 6l4 4"/></svg>' +
        "<span>先填写 API Key 才能开始对话</span>" +
        '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' +
        "</button>";
    }
    html += "</div>";
    return html;
  }

  /* 应用当前对话的背景图 */
  function applyChatBackground(session) {
    var bg = (session && session.background) || "";
    if (bg) {
      $chat.classList.add("has-bg");
      $chat.style.setProperty("--bg-img", 'url("' + bg + '")');
    } else {
      $chat.classList.remove("has-bg");
      $chat.style.removeProperty("--bg-img");
    }
  }

  /* ==================================================================
     长对话分页渲染
     一次只渲染最后 PAGE_SIZE 条，往上滚再按页加，避免几百条消息
     同时解析 Markdown 把低端机卡死。
     ================================================================== */
  var PAGE_SIZE = 30;
  var shownCount = 0;
  var loadingOlder = false;

  function renderMessages() {
    var s = getSession();
    applyChatBackground(s);
    $messages.innerHTML = "";
    shownCount = 0;

    if (!s) {
      $messages.innerHTML = welcomeHtml();
      return;
    }

    var vis = Store.visibleTurns(s);
    if (!vis.length) {
      $messages.innerHTML = welcomeHtml();
      return;
    }

    appendTail(PAGE_SIZE);
  }

  /* 从末尾往前追加 n 条，不动已经渲染好的节点 */
  function appendTail(n) {
    var s = getSession();
    if (!s) return;

    var vis = Store.visibleTurns(s);
    var total = vis.length;
    var start = Math.max(0, total - shownCount - n);
    var end = total - shownCount;
    if (end <= start) return;

    var frag = document.createDocumentFragment();
    for (var i = start; i < end; i++) {
      frag.appendChild(turnNode(vis[i]));
    }

    var wrap = $("loadMoreWrap");
    if (wrap && wrap.parentNode === $messages) {
      $messages.insertBefore(frag, wrap.nextSibling);
    } else {
      $messages.appendChild(frag);
    }

    shownCount += (end - start);
    refreshLoadMore(total);
  }

  function refreshLoadMore(total) {
    var wrap = $("loadMoreWrap");
    var remain = total - shownCount;

    if (remain <= 0) {
      if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
      return;
    }

    if (!wrap || wrap.parentNode !== $messages) {
      wrap = document.createElement("div");
      wrap.id = "loadMoreWrap";
      wrap.className = "load-more-wrap";
      wrap.innerHTML = '<button type="button" class="load-more" id="loadMoreBtn"></button>';
      $messages.insertBefore(wrap, $messages.firstChild);
    }

    var btn = $("loadMoreBtn");
    if (btn) {
      btn.textContent = "加载更早的 " + Math.min(PAGE_SIZE, remain) + " 条 · 还剩 " + remain + " 条";
    }
  }

  function loadOlder() {
    if (loadingOlder || !getSession()) return;
    loadingOlder = true;

    var beforeH = $chat.scrollHeight;
    var beforeTop = $chat.scrollTop;

    appendTail(PAGE_SIZE);

    // 插到顶部后把视口「钉」在原处，避免内容跳动
    var afterH = $chat.scrollHeight;
    $chat.scrollTop = beforeTop + (afterH - beforeH);

    loadingOlder = false;
  }

  function modelLabel(s) {
    var chat = (s && s.chat) || {};
    var model = API.modelOf(s);
    if (model === "deepseek-v4-pro") return "V4 Pro";
    if (chat.thinking && chat.webSearch) return "思考 + 搜索";
    if (chat.thinking) return "深度思考";
    if (chat.webSearch) return "联网搜索";
    return "快速回答";
  }

  function renderTopbar() {
    var s = getSession();
    var p = personaOf(s);
    $("chatTitle").textContent = s ? s.title : "新对话";
    $("personaNameTop").textContent = p.name;
    $("topAvatar").src = avatarOf(p);
    $("brandAvatar").src = avatarOf(p);
    $("modelName").textContent = modelLabel(s);
    $("brandSub").textContent = "DeepSeek 手机助手";
    $("btnAutoRead").setAttribute("aria-pressed", settings.autoRead ? "true" : "false");
    syncComposerState();
  }

  /* ==================================================================
     渲染：会话抽屉
     ================================================================== */
  function renderDrawer() {
    var list = $("sessionList");
    var kw = ($("searchSessions").value || "").trim().toLowerCase();
    var arr = sortedSessions();

    if (kw) {
      arr = arr.filter(function (s) {
        if (s.title.toLowerCase().indexOf(kw) !== -1) return true;
        var vis = Store.visibleTurns(s);
        for (var i = 0; i < vis.length; i++) {
          var ed = vis[i].edits[vis[i].activeEdit] || vis[i].edits[0];
          if (ed && String(ed.text || "").toLowerCase().indexOf(kw) !== -1) return true;
          var rp = ed && (ed.replies[ed.activeReply] || ed.replies[0]);
          if (rp && String(rp.content || "").toLowerCase().indexOf(kw) !== -1) return true;
        }
        return false;
      });
    }

    if (!arr.length) {
      list.innerHTML = '<div class="empty-tip">' +
        (kw ? "没有找到匹配的对话" : "还没有对话记录<br>点击右上角 + 开始新对话") + "</div>";
      return;
    }

    var html = "";
    var lastGroup = "";
    for (var i = 0; i < arr.length; i++) {
      var s = arr[i];
      var g = dayLabel(s.updatedAt);
      if (g !== lastGroup) {
        html += '<div class="sess-group">' + esc(g) + "</div>";
        lastGroup = g;
      }
      var active = s.id === state.activeId ? " active" : "";
      var visList = Store.visibleTurns(s);
      var lastTurn = visList.length ? visList[visList.length - 1] : null;
      var lastEdit = lastTurn && lastTurn.edits
        ? (lastTurn.edits[lastTurn.activeEdit] || lastTurn.edits[0]) : null;
      var lastRep = lastEdit && lastEdit.replies
        ? (lastEdit.replies[lastEdit.activeReply] || lastEdit.replies[0]) : null;
      var lastText = (lastRep && lastRep.content) || (lastEdit && lastEdit.text) || "";
      // 只取前 3000 字做预览，避免超长消息让抽屉列表变慢
      var sub = lastText ? plainPreview(String(lastText).slice(0, 3000)).slice(0, 40) : "空对话";
      var sp = personaOf(s);
      html += '<div class="sess' + active + '" data-sid="' + s.id + '">' +
        '<img class="sess-avatar" src="' + esc(avatarOf(sp)) + '" alt="">' +
        '<div class="sess-main"><div class="sess-title">' + esc(s.title) + "</div>" +
        '<div class="sess-sub">' + esc(sub) + "</div></div>" +
        '<button class="sess-del" type="button" data-del="' + s.id + '" aria-label="删除对话">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>' +
        "</button></div>";
    }
    list.innerHTML = html;
  }

  /* ==================================================================
     抽屉 / 设置 开关
     ================================================================== */
  function openDrawer() {
    renderDrawer();
    $("scrim").hidden = false;
    void $("scrim").offsetWidth;
    $("scrim").classList.add("show");
    $("drawer").classList.add("open");
    $("drawer").setAttribute("aria-hidden", "false");
  }

  function closeDrawer() {
    $("scrim").classList.remove("show");
    $("drawer").classList.remove("open");
    $("drawer").setAttribute("aria-hidden", "true");
    setTimeout(function () { $("scrim").hidden = true; }, 260);
  }

  function syncSettingsUI() {
    var dp = settings.defaultPersona || {};
    $("setApiKey").value = settings.apiKey || "";
    $("setBaseUrl").value = settings.baseUrl || "";
    $("setDefName").value = dp.name || "";
    $("setSystem").value = dp.prompt || "";
    var budget = parseInt(settings.contextBudget, 10) || 120000;
    $("setCtx").value = Math.round(budget / 10000);
    $("ctxVal").textContent = Math.round(budget / 10000);
    $("setTemp").value = settings.temperature;
    $("tempVal").textContent = Number(settings.temperature).toFixed(1);
    $("setMax").value = settings.maxTokens || 0;
    $("maxVal").textContent = settings.maxTokens > 0 ? settings.maxTokens : "不限";
    $("setAutoSnap").checked = !!settings.autoSnapshot;
    $("setAutoMemory").checked = settings.autoMemory !== false;
    $("setClock").checked = !!settings.showClock;
    $("appVer").textContent = "v" + AppVersion;

    markSeg($("setModel"), settings.model);
    markSeg($("setTheme"), settings.theme);
    markSeg($("setFont"), settings.fontSize);

    var st = Store.stats();
    $("statSessions").textContent = st.sessions;
    $("statMessages").textContent = st.messages;
    $("statSize").textContent = st.bytes > 1024 * 1024
      ? (st.bytes / 1048576).toFixed(1) + " MB"
      : Math.max(1, Math.round(st.bytes / 1024)) + " KB";
  }

  function markSeg(container, value) {
    var btns = container.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute("data-v") === value;
      btns[i].classList.toggle("on", on);
    }
  }

  function openSettings() {
    syncSettingsUI();
    $("settingsSheet").classList.add("open");
    $("settingsSheet").setAttribute("aria-hidden", "false");
  }

  function closeSettings() {
    $("settingsSheet").classList.remove("open");
    $("settingsSheet").setAttribute("aria-hidden", "true");
    renderTopbar();
    renderMessagesMeta();
  }

  function renderMessagesMeta() {
    // 模型名可能变了，刷新顶栏与欢迎页提示
    renderTopbar();
    var s = getSession();
    if (!s || !Store.visibleTurns(s).length) {
      $messages.innerHTML = welcomeHtml();
    }
  }

  /* ==================================================================
     滚动
     ================================================================== */
  function nearBottom() {
    return $chat.scrollHeight - $chat.scrollTop - $chat.clientHeight < 120;
  }

  function scrollToBottom(smooth) {
    if (smooth === false) {
      $chat.scrollTop = $chat.scrollHeight;
      return;
    }
    try {
      $chat.scrollTo({ top: $chat.scrollHeight, behavior: "smooth" });
    } catch (e) {
      $chat.scrollTop = $chat.scrollHeight;
    }
  }

  /* 进对话 / 切换对话时直接停在最新一条，不用手动往下滑 */
  function snapToBottom() {
    function go() {
      if (autoScroll) $chat.scrollTop = $chat.scrollHeight;
    }
    go();
    requestAnimationFrame(go);
    setTimeout(go, 60);
    setTimeout(go, 220);
  }

  var scrollRaf = null;
  function onScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () {
      scrollRaf = null;
      var nb = nearBottom();
      $("btnScrollBottom").classList.toggle("hidden", nb);
      autoScroll = nb;
    });
  }

  /* ==================================================================
     发送 / 生成
     ================================================================== */
  function updateSendState() {
    var attached = (pendingAttachments && pendingAttachments.length) || 0;
    var has = $input.value.trim().length > 0 || attached > 0;
    $sendBtn.disabled = !has && !streaming;
    $sendBtn.classList.toggle("hidden", streaming);
    $stopBtn.classList.toggle("hidden", !streaming);
  }

  function setStreaming(v) {
    streaming = v;
    updateSendState();
  }

  function autoResize() {
    $input.style.height = "auto";
    var h = Math.min($input.scrollHeight, 132);
    $input.style.height = h + "px";
  }

  function ensureSessionForSend() {
    var s = getSession();
    if (!s) {
      s = createSession();
      // 新会话先不要出现在列表里，等有第一条消息再加
    }
    return s;
  }

  function addMessage(session, msg) {
    session.messages.push(msg);
    session.updatedAt = Date.now();
  }

  /* 正在修改的那一条（null 表示普通发送） */
  var editingTurnId = null;

  function updateEditingHint() {
    var box = $("composerBox");
    var hint = $("composerHint");
    if (!hint) return;

    if (editingTurnId) {
      box.classList.add("editing");
      hint.innerHTML =
        '<span class="hint-text">正在修改已发送的内容</span>' +
        '<button type="button" class="hint-cancel" id="btnCancelEdit">取消修改</button>';
      hint.classList.add("clickable");
    } else {
      box.classList.remove("editing");
      hint.innerHTML = "";
      hint.classList.remove("clickable");
    }
  }

  /* 退出修改模式；clearInput 为 true 时连输入框一起清空 */
  function exitEditing(clearInput) {
    if (!editingTurnId) return false;
    editingTurnId = null;
    if (clearInput) {
      $input.value = "";
      clearAttachments();
      autoResize();
    }
    updateSendState();
    updateEditingHint();
    return true;
  }

  /* 把修改后的内容写成这条输入的一个新版本 */
  function commitEdit(f, text, atts) {
    var s = f.session;
    var turn = f.turn;

    if (turn.edits.length >= 6) {
      toast("同一条输入最多 6 个版本", 2400);
      return;
    }

    // 不再删除后面的对话：它们的 branch 指向旧版本，切换后会自然隐藏
    turn.edits.push({
      id: Store.uid("e"),
      text: text,
      createdAt: Date.now(),
      images: atts.filter(function (a) { return a.type === "image"; }).map(function (a) { return a.dataUrl; }),
      files: atts.filter(function (a) { return a.type === "file"; }).map(function (a) { return { name: a.name, text: a.text }; }),
      replies: [{
        id: Store.uid("r"), content: "", reasoning: "",
        model: API.modelOf(s), createdAt: Date.now()
      }],
      activeReply: 0
    });
    turn.activeEdit = turn.edits.length - 1;

    editingTurnId = null;
    $input.value = "";
    clearAttachments();
    autoResize();
    updateSendState();
    updateEditingHint();

    renderMessages();
    renderDrawer();
    Store.save();
    setStreaming(false);
    startGeneration(s, turn.id);
    snapToBottom();
  }

  function doSend() {
    if (streaming) return;
    var text = $input.value.trim();
    var atts = pendingAttachments.slice();
    if (!text && !atts.length) return;
    if (!settings.apiKey) {
      toast("请先填写 API Key");
      openSettings();
      return;
    }

    // 修改已发送的内容：走另一条路径
    if (editingTurnId) {
      var ef = findTurn(editingTurnId);
      if (ef) {
        var visEf = Store.visibleTurns(ef.session);
        var posEf = -1;
        for (var vi = 0; vi < visEf.length; vi++) {
          if (visEf[vi].id === ef.turn.id) { posEf = vi; break; }
        }
        var rest = posEf >= 0 ? (visEf.length - 1 - posEf) : 0;

        if (rest > 0) {
          confirmDialog(
            "修改这条输入？",
            "后面还有 " + rest + " 条对话，会先隐藏起来。切回这条输入原来的版本就能再看到它们。",
            "修改"
          ).then(function (ok) {
            if (ok) commitEdit(ef, text, atts);
          });
          return;
        }
        commitEdit(ef, text, atts);
        return;
      }
      editingTurnId = null;
      updateEditingHint();
    }

    lastUserText = text;
    $input.value = "";
    clearAttachments();
    autoResize();
    updateSendState();

    var session = getSession();
    var isNew = !session;
    if (!session) {
      session = createSession();
    }

    if (isNew || session.messages.length === 0) {
      session.title = trimTitle(text || (atts.length ? "图片 / 文件" : "新对话"));
    }

    // 内容已发出，清掉这个对话的草稿
    session.draft = "";
    session.draftAttachments = [];

    // 新消息挂在「当前可见的最后一条」的当前输入版本下
    var visNow = Store.visibleTurns(session);
    var lastVis = visNow.length ? visNow[visNow.length - 1] : null;

    addMessage(session, {
      id: Store.uid("u"),
      role: "user",
      createdAt: Date.now(),
      branch: lastVis ? {
        turnId: lastVis.id,
        editIndex: lastVis.activeEdit,
        replyIndex: (lastVis.edits[lastVis.activeEdit] || {}).activeReply || 0
      } : null,
      edits: [{
        id: Store.uid("e"),
        text: text,
        createdAt: Date.now(),
        images: atts.filter(function (a) { return a.type === "image"; }).map(function (a) { return a.dataUrl; }),
        files: atts.filter(function (a) { return a.type === "file"; }).map(function (a) { return { name: a.name, text: a.text }; }),
        replies: [],
        activeReply: 0
      }],
      activeEdit: 0
    });

    renderMessages();
    renderDrawer();
    scrollToBottom(false);
    startGeneration(session);
  }

  function startGeneration(session, targetTurnId) {
    var vis = Store.visibleTurns(session);
    var turn = null;

    // 指定了目标就生成那一条（比如对历史回复点重新生成），否则生成最后一条
    if (targetTurnId) {
      for (var ti = 0; ti < vis.length; ti++) {
        if (vis[ti].id === targetTurnId) { turn = vis[ti]; break; }
      }
    }
    if (!turn) turn = vis.length ? vis[vis.length - 1] : null;

    if (!turn || !turn.edits || !turn.edits.length) { setStreaming(false); return; }

    var edit = turn.edits[turn.activeEdit] || turn.edits[0];
    var reply = edit.replies[edit.activeReply];

    if (!reply) {
      reply = {
        id: Store.uid("r"),
        content: "",
        reasoning: "",
        model: API.modelOf(session),
        createdAt: Date.now()
      };
      edit.replies.push(reply);
      edit.activeReply = edit.replies.length - 1;
    }

    reply.model = API.modelOf(session);
    reply.createdAt = Date.now();
    reply.error = false;

    // 后面整段流式逻辑沿用 assistant 这个名字
    var assistant = reply;

    var turnEl = document.querySelector('.turn-block[data-turn="' + turn.id + '"]');
    if (!turnEl) {
      renderMessages();
      turnEl = document.querySelector('.turn-block[data-turn="' + turn.id + '"]');
    }
    var oldAi = turnEl ? turnEl.querySelector(".msg.ai") : null;
    if (oldAi && oldAi.parentNode) oldAi.parentNode.removeChild(oldAi);

    var node = aiNode(turn, assistant, { streaming: true });
    if (turnEl) turnEl.appendChild(node); else $messages.appendChild(node);
    scrollToBottom(false);

    var bubble = node.querySelector(".bubble");
    var streamEl = document.createElement("div");
    streamEl.className = "stream-text";
    var textNode = document.createTextNode("");
    var caret = document.createElement("span");
    caret.className = "caret";
    streamEl.appendChild(textNode);
    streamEl.appendChild(caret);
    bubble.appendChild(streamEl);

    var reasonBox = null;
    var reasonBody = null;

    setStreaming(true);
    controller = typeof AbortController !== "undefined" ? new AbortController() : null;

    var started = Date.now();
    var rafPending = false;

    function scheduleScroll() {
      if (!autoScroll) return;
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(function () {
        rafPending = false;
        $chat.scrollTop = $chat.scrollHeight;
      });
    }

    function ensureReasonBox() {
      if (reasonBox) return;
      reasonBox = document.createElement("div");
      reasonBox.className = "reasoning open";
      reasonBox.innerHTML = '<button class="reasoning-head" type="button">' +
        '<svg class="spark" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>' +
        "<span>正在深度思考…</span>" +
        '<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
        "</button><div class=\"reasoning-body\"></div>";
      node.insertBefore(reasonBox, bubble);
      reasonBody = reasonBox.querySelector(".reasoning-body");
    }

    var searchNote = null;
    function showSearch(info) {
      if (!searchNote) {
        searchNote = document.createElement("div");
        searchNote.className = "search-note";
        node.insertBefore(searchNote, bubble);
      }
      if (info.phase === "start") {
        var q = (info.action && info.action.queries) ? info.action.queries.join(" · ") : "";
        var u = (info.action && info.action.url) ? info.action.url : "";
        searchNote.textContent = "正在联网搜索 " + (q || u || "");
        searchNote.classList.add("active");
      } else {
        searchNote.textContent = "已联网搜索";
        searchNote.classList.remove("active");
      }
      scheduleScroll();
    }

    var firstToken = true;

    API.chat({
      settings: settings,
      session: session,
      signal: controller ? controller.signal : undefined,
      onTool: showSearch,
      onCitations: function (anns) {
        assistant.citations = (anns || []).map(function (a) {
          var c = a.url_citation || {};
          return { url: c.url, title: c.title || c.url };
        }).filter(function (c) { return c.url; });
      },
      onReasoning: function (chunk) {
        ensureReasonBox();
        assistant.reasoning += chunk;
        reasonBody.appendChild(document.createTextNode(chunk));
        if (autoScroll) reasonBody.scrollTop = reasonBody.scrollHeight;
        scheduleScroll();
      },
      onDelta: function (chunk) {
        if (firstToken) {
          firstToken = false;
          if (reasonBox) {
            reasonBox.classList.remove("open");
            reasonBox.querySelector(".reasoning-head span").textContent =
              "深度思考（已用 " + ((Date.now() - started) / 1000).toFixed(0) + " 秒）";
          }
        }
        assistant.content += chunk;
        textNode.appendData(chunk);
        scheduleScroll();
      },
      onUsage: function (u) {
        assistant.usage = u;
      },
      onDone: finish,
      onFinish: function () {}
    }).catch(function (err) {
      finish(err);
    });

    function finish(err) {
      if (assistant.done) return;
      assistant.done = true;
      setStreaming(false);
      controller = null;

      var duration = Math.round((Date.now() - started) / 1000);
      assistant.duration = duration;
      delete assistant.pending;

      if (err) {
        if (err.aborted) {
          if (!assistant.content) {
            // 完全没输出：移除空消息
            var idx = session.messages.indexOf(assistant);
            if (idx >= 0) session.messages.splice(idx, 1);
            renderMessages();
            toast("已停止");
            Store.save();
            return;
          }
          assistant.content += "\n\n_（已停止生成）_";
        } else {
          assistant.error = true;
          assistant.content = err.message || "请求失败";
        }
      }

      if (!assistant.content && !assistant.reasoning) {
        assistant.error = true;
        assistant.content = "没有收到回复内容，请重试";
      }

      // 结算本次用量与费用
      if (assistant.usage && !assistant.error) {
        try {
          assistant.cost = computeCost(assistant.model || API.modelOf(session), assistant.usage, started);
        } catch (e) { /* 计费失败不影响展示 */ }
      }

      if (searchNote) {
        searchNote.textContent = "已联网搜索";
        searchNote.classList.remove("active");
      }

      // 用最终形态替换节点（重新渲染这一回合，才能带出价格按钮和版本箭头）
      if (turnEl && turnEl.parentNode) {
        var fresh = turnNode(turn);
        turnEl.parentNode.replaceChild(fresh, turnEl);
      } else if (node.parentNode) {
        node.parentNode.replaceChild(aiNode(turn, assistant), node);
      }

      session.updatedAt = Date.now();
      renderDrawer();
      Store.save();
      Store.createSnapshot();
      if (autoScroll) scrollToBottom(true);

      // 自动朗读：顶栏喇叭打开时，回复完成后直接读出来
      if (settings.autoRead && !assistant.error && assistant.content) {
        var targetId = assistant.id;
        var targetSession = session;
        var targetReply = assistant;
        setTimeout(function () {
          var cur = getSession();
          if (cur && cur.id === targetSession.id) speakReply(targetReply);
        }, 350);
      }

      // 后台整理长期记忆（不影响当前回复，失败也无所谓）
      if (!assistant.error) {
        setTimeout(function () {
          try { maybeUpdateMemory(session); } catch (e) { }
        }, 1500);
      }
    }
  }

  function stopGeneration() {
    if (controller) {
      try { controller.abort(); } catch (e) {}
    }
  }

  /* ==================================================================
     消息操作
     ================================================================== */
  /* 切换对话：各自保留草稿，并退出修改模式，避免内容串到别的对话 */
  function switchToSession(sid) {
    if (state.activeId === sid) { closeDrawer(); return; }

    var prev = getSession();

    if (editingTurnId) {
      // 正在改别的对话的内容，直接丢弃
      exitEditing(true);
    } else if (prev) {
      prev.draft = $input.value;
      prev.draftAttachments = pendingAttachments.slice();
    }

    state.activeId = sid;
    closeDrawer();

    var cur = getSession();
    $input.value = (cur && cur.draft) || "";
    pendingAttachments = (cur && cur.draftAttachments) ? cur.draftAttachments.slice() : [];
    renderAttachments();
    autoResize();
    updateSendState();

    renderMessages();
    renderTopbar();
    renderDrawer();
    snapToBottom();
    Store.save();
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        resolve();
      } catch (e) {
        reject(e);
      }
      document.body.removeChild(ta);
    });
  }

  function findTurn(id) {
    var s = getSession();
    if (!s) return null;
    for (var i = 0; i < s.messages.length; i++) {
      if (s.messages[i].id === id) return { turn: s.messages[i], index: i, session: s };
    }
    return null;
  }

  function findReply(turn, replyId) {
    var edit = turn.edits[turn.activeEdit] || turn.edits[0];
    var list = edit.replies;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === replyId) return list[i];
    }
    return list[edit.activeReply] || list[list.length - 1];
  }

  /* 只替换这一个回合的 DOM，避免整页重渲染导致滚动跳动 */
  function refreshTurn(turn) {
    var old = document.querySelector('.turn-block[data-turn="' + turn.id + '"]');
    if (!old || !old.parentNode) { renderMessages(); return; }
    old.parentNode.replaceChild(turnNode(turn), old);
  }

  /* 切换版本后，后面的分支可能整段出现或消失，所以要整体重排 */
  function refreshAfterSwitch(turn) {
    var old = document.querySelector('.turn-block[data-turn="' + turn.id + '"]');
    var prevTop = old ? old.getBoundingClientRect().top : null;

    renderMessages();

    var neu = document.querySelector('.turn-block[data-turn="' + turn.id + '"]');
    if (neu && prevTop !== null) {
      $chat.scrollTop += (neu.getBoundingClientRect().top - prevTop);
    }
  }

  function handleAction(act, turnId, side, replyId) {
    var f = findTurn(turnId);
    if (!f) return;

    var turn = f.turn;
    var s = f.session;
    var edit = turn.edits[turn.activeEdit] || turn.edits[0];
    var reply = replyId ? findReply(turn, replyId)
      : (edit.replies[edit.activeReply] || edit.replies[edit.replies.length - 1]);

    // 左右切换版本
    if (act === "vprev" || act === "vnext") {
      var dir = act === "vnext" ? 1 : -1;
      if (side === "user") {
        var n = turn.edits.length;
        turn.activeEdit = (turn.activeEdit + dir + n) % n;
      } else {
        var m = edit.replies.length;
        edit.activeReply = (edit.activeReply + dir + m) % m;
      }
      refreshAfterSwitch(turn);
      s.updatedAt = Date.now();
      Store.save();
      return;
    }

    if (act === "speak") { speakReply(reply); return; }

    if (act === "usage") {
      var card = document.querySelector('.usage-card[data-for="' + reply.id + '"]');
      if (card) card.hidden = !card.hidden;
      return;
    }

    if (act === "copy") {
      var text = side === "user" ? (edit.text || "") : ((reply && reply.content) || "");
      copyText(text).then(function () {
        toast("已复制");
      }).catch(function () {
        toast("复制失败");
      });
      return;
    }

    if (act === "del") {
      confirmDialog("删除这一轮对话？", "这条输入和它下面的各个版本都会一起删除。", "删除").then(function (ok) {
        if (!ok) return;
        var deadId = turn.id;
        s.messages.splice(f.index, 1);

        // 挂在被删消息下面的分支已经找不到父节点了，把它们挪回根分支，避免永久隐藏
        s.messages.forEach(function (t) {
          if (t.branch && t.branch.turnId === deadId) t.branch = null;
        });

        s.updatedAt = Date.now();
        renderMessages();
        renderDrawer();
        Store.save();
      });
      return;
    }

    // 重新生成：在当前输入下再开一个版本
    if (act === "retry") {
      if (edit.replies.length >= 6) {
        toast("同一条输入最多重新生成 6 次", 2400);
        return;
      }
      edit.replies.push({
        id: Store.uid("r"),
        content: "",
        reasoning: "",
        model: API.modelOf(s),
        createdAt: Date.now()
      });
      edit.activeReply = edit.replies.length - 1;

      // 换了回复版本，后面挂在旧回复上的对话会自动隐藏，所以整页重排
      refreshAfterSwitch(turn);
      Store.save();
      setStreaming(false);
      startGeneration(s, turn.id);
      scrollToBottom(false);
      return;
    }

    // 修改自己说过的话：把内容放回输入框，改完再发出去
    if (act === "editmsg") {
      var curEdit = turn.edits[turn.activeEdit] || turn.edits[0];

      editingTurnId = turn.id;
      $input.value = curEdit.text || "";

      pendingAttachments = [];
      (curEdit.images || []).forEach(function (url) {
        pendingAttachments.push({ type: "image", dataUrl: url });
      });
      (curEdit.files || []).forEach(function (f) {
        pendingAttachments.push({ type: "file", name: f.name, text: f.text });
      });

      renderAttachments();
      autoResize();
      updateSendState();
      updateEditingHint();
      try { $input.focus(); } catch (e) { }
      scrollToBottom(false);
      return;
    }
  }

  /* ==================================================================
     备份
     ================================================================== */
  function downloadBlob(name, text) {
    var blob = new Blob([text], { type: "application/json;charset=utf-8" });

    // iOS Safari 不支持 <a download>：优先走系统「分享 / 存储到文件」
    var file = null;
    try { file = new File([blob], name, { type: "application/json" }); } catch (e) { }

    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      navigator.share({ files: [file], title: "DeepFish 备份" }).catch(function () {
        // 用户取消，或分享失败 → 退回普通下载
        fallbackDownload(blob, name);
      });
      return;
    }
    fallbackDownload(blob, name);
  }

  function fallbackDownload(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function b64EncodeUnicode(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  // 导出对话框：导出时可选择是否包含 API Key
  function showExportDialog() {
    openModal({
      title: "导出备份文件",
      message: "将生成一个 JSON 备份文件，包含全部对话记录。\n备份里可以不含 API Key，更安全。",
      okText: "导出",
      cancelText: "取消"
    }).then(function (ok) {
      if (!ok) return;
      doExport(true);
    });
  }

  function doExport(noKey) {
    var pack = Store.exportFile(!noKey);
    var applied = false;

    if (isNative()) {
      try {
        var cap = window.Capacitor;
        var FS = cap.Plugins && cap.Plugins.Filesystem;
        var Share = cap.Plugins && cap.Plugins.Share;
        if (FS) {
          applied = true;
          FS.writeFile({
            path: pack.name,
            data: b64EncodeUnicode(pack.json),
            directory: "CACHE",
            encoding: "base64"
          }).then(function (res) {
            if (Share) {
              return Share.share({
                title: "保存备份文件",
                url: res.uri,
                dialogTitle: "保存「" + pack.name + "」"
              });
            }
            toast("已保存到应用缓存目录");
          }).catch(function (e) {
            console.warn(e);
            downloadBlob(pack.name, pack.json);
          });
        }
      } catch (e) { applied = false; }
    }

    if (!applied) {
      downloadBlob(pack.name, pack.json);
      toast("备份已导出（" + Math.round(pack.size / 1024) + " KB）");
    }
    Store.saveImmediate();
  }

  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("读取文件失败")); };
      reader.readAsText(file, "utf-8");
    });
  }

  function importBackup(file) {
    if (!file) return;
    readFileText(file).then(function (txt) {
      var obj;
      try { obj = JSON.parse(txt); } catch (e) {
        throw new Error("文件不是有效的 JSON");
      }
      var n = (obj.sessions || obj.conversations || []).length;
      return openModal({
        title: "导入备份",
        message: "备份中包含 " + n + " 个对话。\n\n「合并」会保留现有对话并追加新的；\n「替换」会清空现有对话。",
        okText: "合并导入",
        cancelText: "替换导入"
      }).then(function (val) {
        if (val === null) return null;
        var mode = val === true ? "merge" : "replace";
        return Store.importData(obj, mode).then(function (report) {
          return report;
        });
      });
    }).then(function (report) {
      if (!report) return;
      state = Store.state;
      settings = state.settings;
      applyTheme();
      applyFont();
      renderTopbar();
      renderMessages();
      renderDrawer();
      syncSettingsUI();
      toast("导入完成：新增 " + report.added + " 个，共 " + report.total + " 个对话");
    }).catch(function (err) {
      toast(err.message || "导入失败");
    });
  }

  /* ==================================================================
     事件绑定
     ================================================================== */
  function bindEvents() {
    // 顶栏
    $("btnMenu").addEventListener("click", openDrawer);
    $("btnDrawerClose").addEventListener("click", closeDrawer);
    $("scrim").addEventListener("click", closeDrawer);
    $("btnNew").addEventListener("click", function () {
      if (streaming) { toast("正在生成，请先停止"); return; }
      switchToSession(null);
      $input.focus();
    });

    // ---------- 角色设定 ----------
    $("btnPersona").addEventListener("click", function () {
      if (streaming) { toast("正在生成，请先停止"); return; }
      openPersona();
    });
    $("btnPersonaClose").addEventListener("click", closePersona);
    $("personaName").addEventListener("input", function () {
      writePersona("name", this.value.trim());
    });
    $("personaPrompt").addEventListener("input", function () {
      writePersona("prompt", this.value);
    });
    $("personaMemory").addEventListener("input", function () {
      var s = getSession();
      if (!s) return;
      s.memory = this.value;
      Store.save();
    });
    $("btnResetAvatar").addEventListener("click", resetAvatar);

    $("btnPickAvatar").addEventListener("click", function () {
      $("avatarFile").value = "";
      $("avatarFile").click();
    });
    $("avatarFile").addEventListener("change", function () {
      var f = this.files && this.files[0];
      if (f) openCropper(f);
    });

    $("btnCropCancel").addEventListener("click", closeCropper);
    $("btnCropOk").addEventListener("click", confirmCrop);
    $("btnCropAnother").addEventListener("click", function () {
      $("avatarFile").value = "";
      $("avatarFile").click();
    });
    $("cropZoom").addEventListener("input", function () {
      cropState.zoom = parseFloat(this.value) || 1;
      applyCropTransform();
    });

    // 裁剪框拖动
    (function bindCropDrag() {
      var vp = $("cropViewport");
      var dragging = false, sx0 = 0, sy0 = 0, ox0 = 0, oy0 = 0;

      function start(x, y) {
        if (!cropState.img) return;
        dragging = true;
        sx0 = x; sy0 = y;
        ox0 = cropState.ox; oy0 = cropState.oy;
      }
      function move(x, y) {
        if (!dragging) return;
        cropState.ox = ox0 + (x - sx0);
        cropState.oy = oy0 + (y - sy0);
        applyCropTransform();
      }
      function stopDrag() { dragging = false; }

      if (window.PointerEvent) {
        vp.addEventListener("pointerdown", function (e) {
          if (!cropState.img) return;
          start(e.clientX, e.clientY);
          try { vp.setPointerCapture(e.pointerId); } catch (err) { }
          e.preventDefault();
        });
        vp.addEventListener("pointermove", function (e) {
          if (!dragging) return;
          move(e.clientX, e.clientY);
          e.preventDefault();
        });
        vp.addEventListener("pointerup", stopDrag);
        vp.addEventListener("pointercancel", stopDrag);
        vp.addEventListener("lostpointercapture", stopDrag);
      } else {
        // iOS 12 及更早、部分旧 WebView 没有 PointerEvent，退回 touch + mouse
        vp.addEventListener("touchstart", function (e) {
          if (!e.touches || !e.touches.length) return;
          var t = e.touches[0];
          start(t.clientX, t.clientY);
          e.preventDefault();
        }, false);
        vp.addEventListener("touchmove", function (e) {
          if (!dragging || !e.touches || !e.touches.length) return;
          var t = e.touches[0];
          move(t.clientX, t.clientY);
          e.preventDefault();
        }, false);
        vp.addEventListener("touchend", stopDrag, false);
        vp.addEventListener("touchcancel", stopDrag, false);
        vp.addEventListener("mousedown", function (e) {
          start(e.clientX, e.clientY);
          e.preventDefault();
        }, false);
        document.addEventListener("mousemove", function (e) {
          if (dragging) move(e.clientX, e.clientY);
        });
        document.addEventListener("mouseup", stopDrag);
      }
    })();

    // ---------- 输入栏开关 ----------
    $("btnThink").addEventListener("click", function () { toggleChatFlag("thinking"); });
    $("btnSearch").addEventListener("click", function () { toggleChatFlag("webSearch"); });

    // ---------- 自动朗读 ----------
    $("btnAutoRead").addEventListener("click", function () {
      unlockAudio();
      settings.autoRead = !settings.autoRead;
      $("btnAutoRead").setAttribute("aria-pressed", settings.autoRead ? "true" : "false");
      Store.save();
      if (!settings.autoRead) stopSpeaking();
      toast(settings.autoRead ? "已开启自动朗读" : "已关闭自动朗读", 1500);
    });

    // ---------- 附件 ----------
    $("btnAttach").addEventListener("click", function () {
      $("attachFile").value = "";
      $("attachFile").click();
    });
    $("attachFile").addEventListener("change", function () {
      addAttachments(this.files);
    });
    $("attachStrip").addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-ai]") : null;
      if (!btn) return;
      var idx = parseInt(btn.getAttribute("data-ai"), 10);
      if (!isNaN(idx)) {
        pendingAttachments.splice(idx, 1);
        renderAttachments();
      }
    });

    // ---------- 导入 ----------
    $("btnImportOpen").addEventListener("click", function () {
      closeDrawer();
      setTimeout(openImport, 150);
    });
    $("btnImportClose").addEventListener("click", closeImport);
    $("btnImportText").addEventListener("click", doImportText);
    $("btnImportUrl").addEventListener("click", doImportUrl);
    $("btnImportConfirm").addEventListener("click", confirmImport);

    $("importPreview").addEventListener("click", function (e) {
      var t = e.target;

      var zipItem = t.closest ? t.closest("[data-zid]") : null;
      if (zipItem) {
        var zid = zipItem.getAttribute("data-zid");
        zipSelected[zid] = !zipSelected[zid];
        renderZipPreview();
        return;
      }

      var allBtn = t.closest ? t.closest("[data-zall]") : null;
      if (allBtn && zipResult) {
        var allOn = zipSelectedCount() === zipResult.conversations.length;
        zipSelected = {};
        if (!allOn) {
          zipResult.conversations.forEach(function (c) { zipSelected[c.id] = true; });
        }
        renderZipPreview();
        return;
      }

      var roleBtn = t.closest ? t.closest("[data-pi]") : null;
      if (roleBtn) {
        var i = parseInt(roleBtn.getAttribute("data-pi"), 10);
        if (previewMsgs[i]) {
          previewMsgs[i].role = previewMsgs[i].role === "user" ? "assistant" : "user";
          renderImportPreview();
        }
        return;
      }
      var delBtn = t.closest ? t.closest("[data-pd]") : null;
      if (delBtn) {
        var j = parseInt(delBtn.getAttribute("data-pd"), 10);
        if (!isNaN(j)) {
          previewMsgs.splice(j, 1);
          renderImportPreview();
        }
      }
    });

    $("btnImportFile").addEventListener("click", function () {
      $("importFileInput").value = "";
      $("importFileInput").click();
    });
    $("importFileInput").addEventListener("change", function () {
      var f = this.files && this.files[0];
      if (f) importFromFile(f);
    });

    $("btnImportZip").addEventListener("click", function () {
      $("importZipInput").value = "";
      $("importZipInput").click();
    });
    $("importZipInput").addEventListener("change", function () {
      var f = this.files && this.files[0];
      if (f) importFromZip(f);
    });

    // ---------- 聊天背景 ----------
    $("btnPickBg").addEventListener("click", function () {
      if (!getSession()) { toast("先发一句话创建对话，再设背景"); return; }
      $("bgFile").value = "";
      $("bgFile").click();
    });
    $("bgFile").addEventListener("change", function () {
      var f = this.files && this.files[0];
      if (f) openCropper(f, "background");
    });
    $("btnClearBg").addEventListener("click", clearBg);

    // ---------- 公告 ----------
    $("btnAgree").addEventListener("click", agreeNotice);

    // ---------- 检查更新 ----------
    $("btnCheckUpdate").addEventListener("click", checkUpdate);

    // 抽屉
    $("searchSessions").addEventListener("input", renderDrawer);

    $("sessionList").addEventListener("click", function (e) {
      var delBtn = e.target.closest ? e.target.closest("[data-del]") : null;
      if (delBtn) {
        e.stopPropagation();
        var sid = delBtn.getAttribute("data-del");
        var target = null;
        for (var i = 0; i < state.sessions.length; i++) {
          if (state.sessions[i].id === sid) target = state.sessions[i];
        }
        if (!target) return;
        confirmDialog("删除对话？", "「" + target.title + "」及其中的全部消息将被删除。", "删除")
          .then(function (ok) {
            if (!ok) return;
            state.sessions = state.sessions.filter(function (s) { return s.id !== sid; });
            if (state.activeId === sid) state.activeId = state.sessions.length ? state.sessions[0].id : null;
            renderDrawer();
            renderMessages();
            renderTopbar();
            Store.save();
            toast("已删除");
          });
        return;
      }

      var item = e.target.closest ? e.target.closest("[data-sid]") : null;
      if (item) {
        if (streaming) { toast("正在生成，请先停止"); return; }
        switchToSession(item.getAttribute("data-sid"));
      }
    });

    $("sessionList").addEventListener("dblclick", function (e) {
      var item = e.target.closest ? e.target.closest("[data-sid]") : null;
      if (!item) return;
      var sid = item.getAttribute("data-sid");
      var s = null;
      for (var i = 0; i < state.sessions.length; i++) if (state.sessions[i].id === sid) s = state.sessions[i];
      if (!s) return;
      openModal({
        title: "重命名对话",
        message: "",
        input: true,
        value: s.title,
        okText: "保存"
      }).then(function (v) {
        if (!v) return;
        s.title = trimTitle(v);
        s.updatedAt = Date.now();
        renderDrawer();
        renderTopbar();
        Store.save();
      });
    });

    // 设置
    $("btnSettings").addEventListener("click", function () {
      closeDrawer();
      setTimeout(openSettings, 160);
    });
    $("btnSettingsClose").addEventListener("click", closeSettings);

    $("btnToggleKey").addEventListener("click", function () {
      var el = $("setApiKey");
      if (el.type === "password") {
        el.type = "text";
        this.textContent = "隐藏";
      } else {
        el.type = "password";
        this.textContent = "显示";
      }
    });

    $("setApiKey").addEventListener("input", function () {
      settings.apiKey = this.value.trim();
      Store.save();
    });
    $("setBaseUrl").addEventListener("input", function () {
      settings.baseUrl = this.value.trim() || "https://api.deepseek.com";
      Store.save();
    });
    $("setDefName").addEventListener("input", function () {
      settings.defaultPersona.name = this.value.trim();
      Store.save();
    });
    $("setSystem").addEventListener("input", function () {
      settings.defaultPersona.prompt = this.value;
      Store.save();
    });
    $("setCtx").addEventListener("input", function () {
      settings.contextBudget = (parseInt(this.value, 10) || 12) * 10000;
      $("ctxVal").textContent = parseInt(this.value, 10) || 12;
      Store.save();
    });
    $("setTemp").addEventListener("input", function () {
      settings.temperature = parseFloat(this.value);
      $("tempVal").textContent = Number(settings.temperature).toFixed(1);
      Store.save();
    });
    $("setMax").addEventListener("input", function () {
      settings.maxTokens = parseInt(this.value, 10) || 0;
      $("maxVal").textContent = settings.maxTokens > 0 ? settings.maxTokens : "不限";
      Store.save();
    });
    $("setAutoSnap").addEventListener("change", function () {
      settings.autoSnapshot = this.checked;
      Store.save();
    });
    $("setAutoMemory").addEventListener("change", function () {
      settings.autoMemory = this.checked;
      Store.save();
      toast(this.checked ? "已开启自动整理记忆" : "已关闭自动整理记忆", 1600);
    });
    $("setClock").addEventListener("change", function () {
      settings.showClock = this.checked;
      Store.save();
      toast(this.checked ? "模型现在能看到当前时间了" : "已关闭时间提醒", 1800);
    });

    $("setModel").addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-v]") : null;
      if (!b) return;
      settings.model = b.getAttribute("data-v");
      markSeg(this, settings.model);
      Store.save();
      renderTopbar();
    });

    $("setTheme").addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-v]") : null;
      if (!b) return;
      settings.theme = b.getAttribute("data-v");
      markSeg(this, settings.theme);
      applyTheme();
      Store.save();
    });

    $("setFont").addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-v]") : null;
      if (!b) return;
      settings.fontSize = b.getAttribute("data-v");
      markSeg(this, settings.fontSize);
      applyFont();
      Store.save();
    });

    $("btnTestConn").addEventListener("click", function () {
      var btn = this;
      if (!settings.apiKey) { toast("请先填写 API Key"); return; }
      btn.textContent = "测试中…";
      btn.disabled = true;
      API.testConnection(settings).then(function (r) {
        btn.textContent = "测试连接";
        btn.disabled = false;
        var names = (r.models || []).join("、");
        toast("连接成功！可用模型：" + (names || "deepseek-flash"), 3200);
      }).catch(function (err) {
        btn.textContent = "测试连接";
        btn.disabled = false;
        toast(err.message || "连接失败", 3500);
      });
    });

    // 数据
    $("btnExport").addEventListener("click", showExportDialog);
    $("btnImport").addEventListener("click", function () {
      $("fileImport").value = "";
      $("fileImport").click();
    });
    $("fileImport").addEventListener("change", function () {
      importBackup(this.files && this.files[0]);
    });

    $("btnClearAll").addEventListener("click", function () {
      confirmDialog("清空全部数据？", "所有对话、快照和设置都会被删除，且不可恢复。建议先导出备份。", "全部清空")
        .then(function (ok) {
          if (!ok) return;
          Store.clearAll().then(function () {
            state = Store.state;
            settings = state.settings;
            applyTheme();
            applyFont();
            syncSettingsUI();
            renderMessages();
            renderTopbar();
            renderDrawer();
            toast("已清空");
          });
        });
    });

    // 输入
    $input.addEventListener("input", function () {
      autoResize();
      updateSendState();
    });
    $input.addEventListener("focus", function () {
      document.querySelector(".composer-box").classList.add("focus");
      autoScroll = true;
      setTimeout(function () { scrollToBottom(false); }, 260);
    });
    $input.addEventListener("blur", function () {
      document.querySelector(".composer-box").classList.remove("focus");
    });
    // 回车只是换行（手机上容易误触发送），要发送请点右边按钮
    $input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.isComposing) return;
    });

    $sendBtn.addEventListener("click", doSend);
    $stopBtn.addEventListener("click", stopGeneration);

    // 消息区事件委托
    $messages.addEventListener("click", function (e) {
      // 长对话：加载更早的消息
      var moreBtn = e.target.closest ? e.target.closest("#loadMoreBtn") : null;
      if (moreBtn) { loadOlder(); return; }

      var actBtn = e.target.closest ? e.target.closest("[data-act]") : null;
      if (actBtn) {
        handleAction(
          actBtn.getAttribute("data-act"),
          actBtn.getAttribute("data-turn"),
          actBtn.getAttribute("data-side"),
          actBtn.getAttribute("data-reply")
        );
        return;
      }

      var copyBtn = e.target.closest ? e.target.closest(".code-copy") : null;
      if (copyBtn) {
        var pre = copyBtn.closest("pre");
        var code = pre ? pre.querySelector("code") : null;
        if (code) {
          copyText(code.textContent).then(function () {
            copyBtn.innerHTML = copyBtn.innerHTML.replace("复制", "已复制");
            toast("代码已复制");
            setTimeout(function () {
              copyBtn.innerHTML = copyBtn.innerHTML.replace("已复制", "复制");
            }, 1600);
          });
        }
        return;
      }

      var rHead = e.target.closest ? e.target.closest(".reasoning-head") : null;
      if (rHead) {
        var box = rHead.parentNode;
        box.classList.toggle("open");
        return;
      }

      var chip = e.target.closest ? e.target.closest(".chip") : null;
      if (chip) {
        $input.value = chip.getAttribute("data-prompt") || "";
        autoResize();
        updateSendState();
        doSend();
        return;
      }

      // 原生外壳里点击外链：复制地址，避免 WebView 跳走
      var link = e.target.closest ? e.target.closest("a[href]") : null;
      if (link) {
        if (isNative()) {
          e.preventDefault();
          var href = link.getAttribute("href") || "";
          copyText(href).then(function () {
            toast("链接已复制：" + href.slice(0, 48), 2600);
          }).catch(function () {});
        }
        return;
      }

      var setup = e.target.closest ? e.target.closest("#setupKey") : null;
      if (setup) openSettings();
    });

    // 滚动
    $chat.addEventListener("scroll", onScroll, { passive: true });

    // 取消「修改已发送内容」
    $("composerHint").addEventListener("click", function (e) {
      if (!editingTurnId) return;
      e.stopPropagation();
      exitEditing(true);
      toast("已取消修改", 1400);
    });
    $("btnScrollBottom").addEventListener("click", function () {
      autoScroll = true;
      scrollToBottom(true);
    });

    // 视口
    window.addEventListener("resize", function () {
      updateViewport();
      if (autoScroll) scrollToBottom(false);
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", function () {
        updateViewport();
        if (autoScroll) scrollToBottom(false);
      });
    }

    // 系统主题
    if (mediaDark && mediaDark.addEventListener) {
      mediaDark.addEventListener("change", function () {
        if (settings.theme === "auto") applyTheme();
      });
    }

    // 返回键：优先关闭浮层
    window.addEventListener("popstate", function () {
      if ($("settingsSheet").classList.contains("open")) {
        closeSettings();
        history.pushState(null, "");
      } else if ($("drawer").classList.contains("open")) {
        closeDrawer();
        history.pushState(null, "");
      }
    });

    // 页面隐藏时保存
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") Store.saveImmediate();
    });
    window.addEventListener("pagehide", function () { Store.saveImmediate(); });
  }

  /* ==================================================================
     角色设置面板
     ================================================================== */
  function openPersona() {
    var t = personaTarget();
    var s = getSession();
    $("personaName").value = t.persona.name;
    $("personaPrompt").value = t.persona.prompt;
    $("personaAvatar").src = avatarOf(t.persona);
    $("personaMemory").value = s ? (s.memory || "") : "";
    $("personaMemory").disabled = !s;
    $("personaScope").textContent = t.isDefault ? "新对话默认" : "仅当前对话";
    $("personaSheet").setAttribute("aria-hidden", "false");
    $("personaSheet").classList.add("open");
  }

  function closePersona() {
    $("personaSheet").classList.remove("open");
    $("personaSheet").setAttribute("aria-hidden", "true");
    var st = $chat.scrollTop;
    renderMessages();
    $chat.scrollTop = st;
    renderTopbar();
  }

  function writePersona(field, value) {
    var t = personaTarget();
    if (t.session) t.session.persona[field] = value;
    else settings.defaultPersona[field] = value;
    Store.save();
    renderTopbar();
  }

  function resetAvatar() {
    var t = personaTarget();
    if (t.session) t.session.persona.avatar = "";
    else settings.defaultPersona.avatar = "";
    Store.save();
    $("personaAvatar").src = DEFAULT_AVATAR;
    renderTopbar();
    toast("已恢复默认头像");
  }

  /* ==================================================================
     头像裁剪
     ================================================================== */
  var cropState = { img: null, zoom: 1, ox: 0, oy: 0, baseScale: 1, vw: 300, vh: 300 };
  var cropMode = "avatar";

  function openCropper(file, mode) {
    cropMode = (mode === "background") ? "background" : "avatar";

    // 先定取景框尺寸（背景是竖屏矩形，头像是不带圆角的方形）
    var vp = $("cropViewport");
    if (cropMode === "background") {
      vp.classList.add("rect");
      var ratio = $chat.clientHeight / Math.max(1, $chat.clientWidth);
      ratio = Math.min(2.3, Math.max(1.2, ratio || 1.8));
      var maxW = Math.min(window.innerWidth * 0.6, 260);
      var maxH = window.innerHeight * 0.5;
      var w = maxW;
      var h = w * ratio;
      if (h > maxH) { h = maxH; w = h / ratio; }
      vp.style.width = Math.round(w) + "px";
      vp.style.height = Math.round(h) + "px";
    } else {
      vp.classList.remove("rect");
      vp.style.width = "";
      vp.style.height = "";
    }

    var reader = new FileReader();
    reader.onload = function (e) {
      var el = $("cropImg");
      // 关键：直接加载到页面里的 <img> 上（不能新建 Image 却不插入 DOM）
      el.onload = function () {
        cropState.img = el;
        cropState.zoom = 1;
        cropState.ox = 0;
        cropState.oy = 0;

        cropState.vw = vp.clientWidth || 300;
        cropState.vh = vp.clientHeight || 300;
        var iw = el.naturalWidth || 1;
        var ih = el.naturalHeight || 1;
        // 用较短边填满（cover），保证任何比例都能盖住取景框
        cropState.baseScale = Math.max(cropState.vw / iw, cropState.vh / ih);

        $("cropZoom").value = 1;
        applyCropTransform();
        $("cropper").setAttribute("aria-hidden", "false");
        $("cropper").classList.add("open");
      };
      el.onerror = function () { toast("这张图片读取失败，换一张试试"); };
      el.src = e.target.result;
    };
    reader.onerror = function () { toast("图片读取失败"); };
    reader.readAsDataURL(file);
  }

  function applyCropTransform() {
    var st = cropState;
    if (!st.img) return;
    var iw = st.img.naturalWidth || 1;
    var ih = st.img.naturalHeight || 1;
    var s = st.baseScale * st.zoom;
    var dw = iw * s;
    var dh = ih * s;

    // 图片必须始终盖满裁剪框
    var maxX = Math.max(0, (dw - st.vw) / 2);
    var maxY = Math.max(0, (dh - st.vh) / 2);
    st.ox = Math.max(-maxX, Math.min(maxX, st.ox));
    st.oy = Math.max(-maxY, Math.min(maxY, st.oy));

    var left = (st.vw - dw) / 2 + st.ox;
    var top = (st.vh - dh) / 2 + st.oy;
    $("cropImg").style.transform =
      "translate(" + left + "px," + top + "px) scale(" + s + ")";
  }

  function closeCropper() {
    $("cropper").classList.remove("open");
    $("cropper").setAttribute("aria-hidden", "true");
  }

  function confirmCrop() {
    var st = cropState;
    if (!st.img) return;

    // 头像输出 256×256；背景按取景框比例输出 720 宽的竖图
    var isBg = cropMode === "background";
    var W = isBg ? 720 : 256;
    var H = isBg ? Math.round(W * (st.vh / Math.max(1, st.vw))) : 256;

    var canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    var s = st.baseScale * st.zoom;
    var iw = st.img.naturalWidth || 1;
    var ih = st.img.naturalHeight || 1;
    var dw = iw * s;
    var dh = ih * s;
    var left = (st.vw - dw) / 2 + st.ox;
    var top = (st.vh - dh) / 2 + st.oy;

    var sx = -left / s;
    var sy = -top / s;
    var sw = st.vw / s;
    var sh = st.vh / s;

    try {
      ctx.drawImage(st.img, sx, sy, sw, sh, 0, 0, W, H);
    } catch (e) {
      toast("裁剪失败，换一张图片试试");
      return;
    }

    var dataUrl;
    try {
      dataUrl = canvas.toDataURL("image/jpeg", isBg ? 0.82 : 0.86);
    } catch (e) {
      toast("图片处理失败");
      return;
    }

    if (isBg) {
      var s0 = getSession();
      if (!s0) { toast("先发一句话创建对话，再设背景"); closeCropper(); return; }
      s0.background = dataUrl;
      s0.updatedAt = Date.now();
      Store.save();
      applyChatBackground(s0);
      renderBgPreview();
      closeCropper();
      toast("背景已更新");
      return;
    }

    var t = personaTarget();
    if (t.session) t.session.persona.avatar = dataUrl;
    else settings.defaultPersona.avatar = dataUrl;

    Store.save();
    $("personaAvatar").src = dataUrl;
    renderTopbar();
    closeCropper();
    toast("头像已更新");
  }

  /* ==================================================================
     输入栏：深度思考 / 智能搜索 开关
     ================================================================== */
  function chatFlags() {
    var s = getSession();
    if (s) {
      if (!s.chat) s.chat = { thinking: false, webSearch: false, model: "" };
      return s.chat;
    }
    if (!settings.defaultChat) settings.defaultChat = { thinking: false, webSearch: false };
    return settings.defaultChat;
  }

  function syncComposerState() {
    var s = getSession();
    var isFlash = API.modelOf(s) === "deepseek-flash";
    var f = chatFlags();
    $("btnThink").style.display = isFlash ? "" : "none";
    $("btnSearch").style.display = isFlash ? "" : "none";
    $("btnThink").setAttribute("aria-pressed", f.thinking ? "true" : "false");
    $("btnSearch").setAttribute("aria-pressed", f.webSearch ? "true" : "false");
  }

  function toggleChatFlag(flag) {
    var s = getSession();
    // v4-pro 不提供联网搜索，直接提示而不是静默失效
    if (flag === "webSearch" && API.modelOf(s) === "deepseek-v4-pro") {
      toast("v4-pro 不支持联网搜索，要用搜索请切回 flash", 2600);
      return;
    }

    var f = chatFlags();
    f[flag] = !f[flag];
    Store.save();
    syncComposerState();
    if (s) { s.updatedAt = Date.now(); renderTopbar(); }
    if (flag === "thinking") toast(f.thinking ? "已开启深度思考" : "已关闭深度思考", 1200);
    else toast(f.webSearch ? "已开启智能搜索" : "已关闭智能搜索", 1200);
  }

  /* ==================================================================
     附件：图片与文本文件
     ================================================================== */
  var pendingAttachments = [];

  function compressImage(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var w = img.width, h = img.height;
          var scale = Math.min(1, (maxSide || 1400) / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          var ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
          try {
            resolve(canvas.toDataURL("image/jpeg", quality || 0.85));
          } catch (err) { reject(err); }
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function addAttachments(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;

    var jobs = list.map(function (f) {
      if (/^image\//.test(f.type)) {
        return compressImage(f, 1400, 0.85).then(function (url) {
          return { type: "image", name: f.name, dataUrl: url, text: "" };
        }).catch(function () { return null; });
      }
      return readFileText(f).then(function (txt) {
        return { type: "file", name: f.name, dataUrl: "", text: String(txt).slice(0, 200000) };
      }).catch(function () { return null; });
    });

    Promise.all(jobs).then(function (items) {
      var added = 0;
      items.forEach(function (it) {
        if (it) { pendingAttachments.push(it); added++; }
      });
      renderAttachments();
      if (added) toast("已添加 " + added + " 个附件", 1400);
      else toast("这些文件类型不支持", 2000);
    });
  }

  function renderAttachments() {
    var strip = $("attachStrip");
    if (!pendingAttachments.length) {
      strip.hidden = true;
      strip.innerHTML = "";
      $("btnAttach").classList.remove("has-items");
      updateSendState();
      return;
    }
    strip.hidden = false;
    $("btnAttach").classList.add("has-items");

    var html = "";
    pendingAttachments.forEach(function (a, i) {
      if (a.type === "image") {
        html += '<div class="attach-item"><img src="' + esc(a.dataUrl) + '" alt="">' +
          '<button class="attach-del" type="button" data-ai="' + i + '">×</button></div>';
      } else {
        var ext = (String(a.name).split(".").pop() || "FILE").slice(0, 4);
        html += '<div class="attach-item"><span class="file-ext">' + esc(ext) + '</span>' +
          '<button class="attach-del" type="button" data-ai="' + i + '">×</button></div>';
      }
    });
    strip.innerHTML = html;
    updateSendState();
  }

  function clearAttachments() {
    pendingAttachments = [];
    renderAttachments();
  }

  /* ==================================================================
     朗读（TTS，tide = 暗潮）
     ================================================================== */
  var playingAudio = null;
  var playingId = null;

  function stopSpeaking() {
    if (playingAudio) {
      try { playingAudio.pause(); } catch (e) { }
      playingAudio = null;
    }
    playingId = null;
    updateSpeakButtons();
  }

  function updateSpeakButtons() {
    var btns = document.querySelectorAll('[data-act="speak"]');
    for (var i = 0; i < btns.length; i++) {
      var turn = findTurn(btns[i].getAttribute("data-turn"));
      var rep = turn ? findReply(turn.turn, null) : null;
      btns[i].classList.toggle("playing", !!rep && rep.id === playingId);
    }
  }

  /* iOS 要求音频必须由用户手势「解锁」一次，否则后续 play() 会被拒绝 */
  var audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    try {
      var a = new Audio();
      a.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
      a.volume = 0.01;
      var p = a.play();
      if (p && p.then) {
        p.then(function () {
          audioUnlocked = true;
          try { a.pause(); } catch (e) { }
        }).catch(function () { });
      }
    } catch (e) { }
  }

  function speakReply(reply) {
    unlockAudio();
    if (!reply) return;

    var id = reply.id;
    if (playingId === id) { stopSpeaking(); return; }
    stopSpeaking();

    var text = plainPreview(String(reply.content || "").slice(0, 12000));
    if (!text) { toast("这条消息没有可朗读的内容"); return; }
    if (!settings.apiKey) { toast("请先填写 API Key"); return; }

    toast("正在合成语音…", 1800);
    API.tts(text, settings.ttsVoice || "tide", settings).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var audio = new Audio(url);
      playingAudio = audio;
      playingId = id;
      audio.onended = function () { stopSpeaking(); };
      audio.onerror = function () { toast("播放失败"); stopSpeaking(); };
      audio.play().then(function () {
        updateSpeakButtons();
        toast("正在朗读", 1200);
      }).catch(function () {
        toast("系统拦截了播放，请再点一次喇叭");
        stopSpeaking();
      });
    }).catch(function (err) {
      toast(err.message || "朗读失败", 3200);
    });
  }

  /* ==================================================================
     聊天背景
     ================================================================== */
  function renderBgPreview() {
    var s = getSession();
    var el = $("bgPreview");
    if (s && s.background) {
      el.style.backgroundImage = 'url("' + s.background + '")';
      el.textContent = "";
    } else {
      el.style.backgroundImage = "";
      el.textContent = "当前使用默认背景";
    }
  }

  function applyBgFromFile(file) {
    var s = getSession();
    if (!s) { toast("先发一句话创建对话，再设背景"); return; }
    compressImage(file, 1600, 0.82).then(function (url) {
      s.background = url;
      s.updatedAt = Date.now();
      Store.save();
      applyChatBackground(s);
      renderBgPreview();
      toast("背景已更换");
    }).catch(function () { toast("图片处理失败"); });
  }

  function clearBg() {
    var s = getSession();
    if (!s) return;
    s.background = "";
    Store.save();
    applyChatBackground(s);
    renderBgPreview();
    toast("已恢复默认背景");
  }

  /* ==================================================================
     导入 DeepSeek 对话
     ================================================================== */
  function openImport() {
    $("importSheet").setAttribute("aria-hidden", "false");
    $("importSheet").classList.add("open");
  }

  function closeImport() {
    $("importSheet").classList.remove("open");
    $("importSheet").setAttribute("aria-hidden", "true");
    previewMsgs = [];
    importMode = "msgs";
    zipResult = null;
    zipSelected = {};
    renderImportPreview();
  }

  function htmlToText(html) {
    var box = document.createElement("div");
    box.innerHTML = html;
    ["script", "style", "noscript"].forEach(function (tag) {
      var els = box.getElementsByTagName(tag);
      while (els.length) els[0].parentNode.removeChild(els[0]);
    });
    return (box.textContent || "").replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n");
  }

  var USER_RE = /^(你|用户|user|human|我)$/i;
  var AI_RE = /^(deepseek|助手|assistant|ai|模型|gpt)$/i;

  function parseImported(raw) {
    var lines = String(raw || "").replace(/\r\n?/g, "\n").split("\n");
    var msgs = [];
    var cur = null;
    var buf = [];

    function flush() {
      var body = buf.join("\n").trim();
      if (cur && body) msgs.push({ role: cur, content: body });
      buf = [];
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var t = line.trim();

      // 形如 "你：" / "DeepSeek:" 的行
      var m = /^(你|用户|user|human|我|deepseek|助手|assistant|ai|模型|gpt)\s*[：:]\s*(.*)$/i.exec(t);
      if (m) {
        var r = USER_RE.test(m[1]) ? "user" : "assistant";
        if (r !== cur) { flush(); cur = r; }
        if (m[2]) buf.push(m[2]);
        continue;
      }

      // 整行只是角色名
      if (USER_RE.test(t)) { if (cur !== "user") { flush(); cur = "user"; } continue; }
      if (AI_RE.test(t)) { if (cur !== "assistant") { flush(); cur = "assistant"; } continue; }

      if (!cur) cur = "user";
      buf.push(line);
    }
    flush();

    // 兜底：没有任何标记时，按空行交替切分
    if (msgs.length < 2) {
      var blocks = String(raw).split(/\n\s*\n+/).map(function (x) { return x.trim(); }).filter(Boolean);
      if (blocks.length >= 2) {
        msgs = blocks.map(function (b, i) {
          return { role: i % 2 === 0 ? "user" : "assistant", content: b };
        });
      }
    }
    return msgs;
  }

  function importAsSession(msgs, titlePrefix) {
    if (!msgs || !msgs.length) { toast("没解析出对话内容"); return; }

    var d = settings.defaultPersona || {};
    var s = createSession();
    s.persona.name = String(d.name || DEFAULT_NAME).trim() || DEFAULT_NAME;
    s.persona.prompt = d.prompt || "";
    s.persona.avatar = d.avatar || "";

    var now = Date.now();
    msgs.forEach(function (m, i) {
      s.messages.push({
        id: Store.uid("m"),
        role: m.role,
        content: m.content,
        reasoning: "",
        createdAt: now + i * 1000
      });
    });

    var firstUser = msgs.filter(function (m) { return m.role === "user"; })[0];
    s.title = (titlePrefix || "导入 · ") + trimTitle(firstUser ? firstUser.content : "对话");
    s.updatedAt = Date.now();

    renderMessages();
    renderTopbar();
    renderDrawer();
    Store.save();
    scrollToBottom(false);
    var noPersona = !String((settings.defaultPersona || {}).prompt || "").trim();
    toast(noPersona
      ? "已导入 " + msgs.length + " 条 · 还没有角色设定，点顶栏头像设置一下"
      : "已导入 " + msgs.length + " 条消息", noPersona ? 3600 : 1800);
  }

  var previewMsgs = [];
  var importMode = "msgs";
  var zipResult = null;
  var zipSelected = {};

  function fmtDay(ts) {
    var d = new Date(ts || Date.now());
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }

  function zipSelectedCount() {
    if (!zipResult) return 0;
    var n = 0;
    zipResult.conversations.forEach(function (c) {
      if (zipSelected[c.id]) n++;
    });
    return n;
  }

  /* DeepSeek 导出包：可勾选的对话列表 */
  function renderZipPreview() {
    var box = $("importPreview");
    var btn = $("btnImportConfirm");
    var r = zipResult;

    if (!r || !r.conversations.length) {
      box.hidden = true;
      box.innerHTML = "";
      btn.hidden = true;
      return;
    }

    var totalMsg = 0;
    r.conversations.forEach(function (c) { totalMsg += c.messages.length; });

    var selCount = zipSelectedCount();
    var allOn = selCount === r.conversations.length;

    box.hidden = false;
    btn.hidden = false;
    btn.disabled = selCount === 0;
    btn.textContent = selCount === 0
      ? "请先勾选要导入的对话"
      : "导入选中的 " + selCount + " 个对话";

    var html = '<div class="zip-toolbar">' +
      "<span>共 " + r.conversations.length + " 个对话 · " + totalMsg + " 条消息</span>" +
      '<button type="button" data-zall="1">' + (allOn ? "全不选" : "全选") + "</button>" +
      "</div>";

    r.conversations.forEach(function (c, i) {
      var on = !!zipSelected[c.id];
      html += '<div class="zip-item' + (on ? " on" : "") + '" data-zid="' + esc(c.id) + '">' +
        '<span class="zip-check">✓</span>' +
        '<span class="zip-title">' + esc(c.title) + "</span>" +
        '<span class="zip-meta">' + c.messages.length + " 条 · " + esc(fmtDay(c.updatedAt)) + "</span>" +
        "</div>";
    });

    if (r.skipped) {
      html += '<div class="zip-more">已跳过 ' + r.skipped + " 个（空对话或被内容过滤）</div>";
    }
    if (r.truncated) {
      html += '<div class="zip-more">文件里还有更早的对话未列出</div>';
    }

    box.innerHTML = html;
  }

  function renderImportPreview() {
    if (importMode === "zip") { renderZipPreview(); return; }

    var box = $("importPreview");
    var btn = $("btnImportConfirm");

    if (!previewMsgs.length) {
      box.hidden = true;
      box.innerHTML = "";
      btn.hidden = true;
      return;
    }

    box.hidden = false;
    btn.hidden = false;
    btn.textContent = "确认导入 " + previewMsgs.length + " 条消息";

    var html = "";
    previewMsgs.forEach(function (m, i) {
      html += '<div class="preview-item">' +
        '<button type="button" class="preview-role ' + (m.role === "user" ? "user" : "assistant") +
        '" data-pi="' + i + '">' + (m.role === "user" ? "用户" : "AI") + "</button>" +
        '<div class="preview-text">' + esc(m.content) + "</div>" +
        '<button type="button" class="preview-del" data-pd="' + i + '">×</button>' +
        "</div>";
    });
    box.innerHTML = html;
  }

  function doImportText() {
    var raw = $("importText").value.trim();
    if (!raw) { toast("先把对话内容粘贴进来"); return; }

    importMode = "msgs";
    zipResult = null;
    previewMsgs = parseImported(raw);
    if (!previewMsgs.length) { toast("没解析出对话内容"); return; }

    renderImportPreview();
    toast("解析出 " + previewMsgs.length + " 条，请检查角色是否正确", 2600);

    var box = $("importPreview");
    if (box.scrollIntoView) {
      try { box.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) { }
    }
  }

  function confirmImport() {
    if (importMode === "zip") { confirmZipImport(); return; }

    if (!previewMsgs.length) { toast("没有可导入的消息"); return; }
    var n = previewMsgs.length;
    importAsSession(previewMsgs, "导入 · ");
    previewMsgs = [];
    renderImportPreview();
    $("importText").value = "";
    closeImport();
    toast("已导入 " + n + " 条消息", 1800);
  }

  /* ---------- DeepSeek 官方导出包（ZIP） ---------- */
  function importFromZip(file) {
    if (!file) return;
    if (!file.size) { toast("这个文件是空的"); return; }
    toast("正在解析压缩包（" + Math.round(file.size / 1024 / 1024 * 10) / 10 + " MB）…", 5000);

    var reader = new FileReader();
    reader.onload = function (e) {
      var buf = e.target.result;
      DSZip.parseExport(buf).then(function (r) {
        if (!r.conversations.length) {
          toast("压缩包里没有可导入的对话", 3200);
          return;
        }
        importMode = "zip";
        zipResult = r;
        previewMsgs = [];
        zipSelected = {};
        renderImportPreview();
        toast("发现 " + r.conversations.length + " 个对话，勾选后导入", 3000);
      }).catch(function (err) {
        toast(err && err.message ? err.message : "解析失败", 5200);
      });
    };
    reader.onerror = function () { toast("文件读取失败"); };
    reader.readAsArrayBuffer(file);
  }

  function confirmZipImport() {
    var r = zipResult;
    if (!r || !r.conversations.length) { toast("没有可导入的对话"); return; }

    var picked = r.conversations.filter(function (c) { return !!zipSelected[c.id]; });
    if (!picked.length) { toast("先勾选要导入的对话"); return; }

    var d = settings.defaultPersona || {};
    var baseName = String(d.name || DEFAULT_NAME).trim() || DEFAULT_NAME;
    var now = Date.now();
    var created = 0;

    picked.forEach(function (c) {
      var ts = c.updatedAt || now;
      var s = {
        id: Store.uid("s"),
        title: trimTitle(c.title) || "导入的对话",
        createdAt: ts,
        updatedAt: ts,
        pinned: false,
        persona: { name: baseName, prompt: d.prompt || "", avatar: d.avatar || "" },
        chat: { thinking: false, webSearch: false, model: "" },
        background: "",
        messages: c.messages.map(function (m, i) {
          return {
            id: Store.uid("m"),
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content || "",
            reasoning: m.reasoning || "",
            createdAt: ts + i * 1000
          };
        })
      };
      state.sessions.push(s);
      created++;
    });

    state.sessions.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    state.activeId = state.sessions.length ? state.sessions[0].id : null;

    zipResult = null;
    importMode = "msgs";
    renderImportPreview();
    closeImport();
    renderMessages();
    renderTopbar();
    renderDrawer();
    Store.save();
    Store.createSnapshot();
    var noP = !String((settings.defaultPersona || {}).prompt || "").trim();
    toast("已导入 " + created + " 个对话" + (noP ? " · 建议先设置角色设定" : ""), 3000);
  }

  /* 解析 JSON 形式的导出文件（兼容常见字段名） */
  function parseJsonHistory(raw) {
    var obj;
    try { obj = JSON.parse(raw); } catch (e) { return []; }

    var arr = null;
    if (Array.isArray(obj)) arr = obj;
    else if (obj && Array.isArray(obj.messages)) arr = obj.messages;
    else if (obj && Array.isArray(obj.conversation)) arr = obj.conversation;
    else if (obj && Array.isArray(obj.history)) arr = obj.history;
    else if (obj && Array.isArray(obj.data)) arr = obj.data;
    else if (obj && Array.isArray(obj.sessions) && obj.sessions[0] && Array.isArray(obj.sessions[0].messages)) {
      arr = obj.sessions[0].messages;
    }
    if (!Array.isArray(arr)) return [];

    var out = [];
    arr.forEach(function (m) {
      if (!m || typeof m !== "object") return;
      var role = String(m.role || m.sender || m.from || m.type || "").toLowerCase();
      var content = m.content;
      if (content == null) content = m.text;
      if (content == null) content = m.message;

      if (Array.isArray(content)) {
        content = content.map(function (p) {
          if (typeof p === "string") return p;
          return (p && (p.text || p.content)) || "";
        }).join("");
      }
      if (typeof content !== "string") content = "";
      content = content.trim();
      if (!content) return;

      if (role.indexOf("user") !== -1 || role === "human" || role === "我") role = "user";
      else if (role.indexOf("assist") !== -1 || role.indexOf("deepseek") !== -1 ||
        role === "ai" || role === "bot" || role === "model") role = "assistant";
      else return;

      out.push({ role: role, content: content });
    });
    return out;
  }

  function importFromFile(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var raw = String(e.target.result || "");
      var msgs = [];

      if (/\.json$/i.test(file.name)) msgs = parseJsonHistory(raw);
      if (!msgs.length) msgs = parseImported(raw);
      if (!msgs.length) { toast("文件里没找到可导入的对话"); return; }

      importMode = "msgs";
      zipResult = null;
      previewMsgs = msgs;
      renderImportPreview();
      $("importText").value = raw.slice(0, 8000);
      toast("已解析 " + msgs.length + " 条，请检查后确认导入", 2600);
    };
    reader.onerror = function () { toast("文件读取失败"); };
    reader.readAsText(file, "utf-8");
  }

  function doImportUrl() {
    var url = $("importUrl").value.trim();
    if (!url) { toast("先填分享链接"); return; }
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    toast("正在尝试抓取页面…", 2200);
    fetch(url, { credentials: "omit" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    }).then(function (html) {
      var text = htmlToText(html);
      var msgs = parseImported(text);
      if (msgs.length < 2) throw new Error("页面里没找到对话内容");
      $("importText").value = text.slice(0, 20000);
      toast("抓取成功，已填入下方，请检查后点「解析并导入」", 3200);
    }).catch(function (e) {
      toast("抓取失败：" + (e.message || "网络限制") + "，请改用方式一", 3600);
    });
  }

  /* ==================================================================
     首次启动公告
     ================================================================== */
  /* 覆盖层自愈：少数设备的合成层不会正确裁剪 transform 移出屏幕的面板，
     会留下一层看不见的全屏遮罩吃掉所有点击。这里检测并强制隐藏。 */
  function auditOverlays() {
    var panels = ["settingsSheet", "personaSheet", "importSheet", "cropper"];
    var healed = 0;

    panels.forEach(function (id) {
      var el = $(id);
      if (!el || el.classList.contains("open")) return;
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { return; }
      if (cs.display === "none" || cs.visibility === "hidden") return;

      var r = el.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.85 && r.height >= window.innerHeight * 0.85) {
        el.style.visibility = "hidden";
        el.style.pointerEvents = "none";
        healed++;
      }
    });

    if (healed && window.console && console.warn) {
      console.warn("[DeepFish] 覆盖层自愈：隐藏了 " + healed + " 个异常面板");
    }
    return healed;
  }

  /* ==================================================================
     检查更新（GitHub Releases）
     ================================================================== */
  var UPDATE_REPO = "wawawa-ship/DeepFish";
  var UPDATE_API = "https://api.github.com/repos/" + UPDATE_REPO;

  function parseVer(v) {
    return String(v || "").replace(/^v/i, "").trim().split(/[.\-+_]/).map(function (x) {
      return parseInt(x, 10) || 0;
    });
  }

  function cmpVer(a, b) {
    var pa = parseVer(a);
    var pb = parseVer(b);
    var n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
      var x = pa[i] || 0;
      var y = pb[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }

  /* GitHub API 未登录时每小时只有 60 次，而且按 IP 算——
     校园网 / 运营商 NAT / 公司网络下很容易被别人一起打满，返回 403。
     所以先试官方 API，失败再退到 jsDelivr 读 package.json 的版本号。 */
  var lastCheckAt = 0;

  function fetchTimeout(url, opts, ms) {
    var ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    var o = opts || {};
    if (ctl) o.signal = ctl.signal;

    return fetch(url, o).then(function (res) {
      clearTimeout(timer);
      return res;
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  function checkViaApi() {
    return fetchTimeout(UPDATE_API + "/releases/latest", {
      method: "GET",
      headers: { "Accept": "application/vnd.github+json" }
    }, 15000).then(function (res) {
      if (res.status === 404) return { kind: "none" };

      if (res.status === 403 || res.status === 429) {
        var reset = parseInt(res.headers.get("X-RateLimit-Reset") || "0", 10);
        var e = new Error("ratelimit");
        e.waitMin = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : 0;
        throw e;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);

      return res.json().then(function (rel) {
        var apk = "";
        (rel.assets || []).forEach(function (a) {
          if (!apk && /\.apk$/i.test(a.name || "")) apk = a.browser_download_url;
        });
        return {
          kind: "release",
          latest: String(rel.tag_name || rel.name || "").replace(/^v/i, ""),
          pageUrl: rel.html_url || ("https://github.com/" + UPDATE_REPO + "/releases"),
          apkUrl: apk,
          notes: String(rel.body || "").replace(/\r/g, "").slice(0, 160)
        };
      });
    });
  }

  /* 备用源：jsDelivr 读仓库里的 package.json，国内一般比 api.github.com 顺 */
  function checkViaCdn() {
    var url = "https://cdn.jsdelivr.net/gh/" + UPDATE_REPO + "@main/package.json";
    return fetchTimeout(url, { method: "GET", cache: "no-store" }, 15000)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (j) {
        var v = String(j.version || "").replace(/^v/i, "");
        if (!v) throw new Error("没有版本号");
        return {
          kind: "package",
          latest: v,
          pageUrl: "https://github.com/" + UPDATE_REPO + "/releases/latest",
          apkUrl: "",
          notes: ""
        };
      });
  }

  function checkUpdate() {
    var btn = $("btnCheckUpdate");
    if (!btn || btn.disabled) return;

    var now = Date.now();
    if (now - lastCheckAt < 20000) {
      toast("刚查过了，稍微等一下再试", 2000);
      return;
    }
    lastCheckAt = now;

    var original = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = "检查中…";

    var finished = false;
    function done() {
      if (finished) return;
      finished = true;
      btn.disabled = false;
      btn.innerHTML = original;
    }

    checkViaApi().catch(function (err) {
      // 限流或网络失败时，先看备用源能不能给出版本号
      return checkViaCdn().catch(function () { throw err; });
    }).then(function (info) {
      done();
      if (!info) return;

      if (info.kind === "none") {
        toast("作者还没有发布正式版本，发布后再来检查", 3000);
        return;
      }

      var latest = info.latest;
      if (!latest) { toast("没有读到版本号"); return; }

      if (cmpVer(latest, AppVersion) <= 0) {
        toast("已是最新版本 v" + AppVersion, 2400);
        return;
      }

      var fallbackNote = info.kind === "package"
        ? "\n\n（这次没连上 GitHub 接口，只读到了版本号；下载请去 Releases 页面）"
        : "";

      openModal({
        title: "发现新版本 v" + latest,
        message: "当前版本 v" + AppVersion + "\n\n" + (info.notes ? info.notes + "\n\n" : "") +
          "点「去下载」后会把链接复制到剪贴板，在浏览器打开即可。" + fallbackNote,
        okText: "去下载",
        cancelText: "稍后"
      }).then(function (ok) {
        if (!ok) return;
        var url = info.apkUrl || info.pageUrl;
        if (isNative()) {
          copyText(url).then(function () {
            toast("下载链接已复制，去浏览器打开", 3200);
          }).catch(function () {
            toast(url, 4000);
          });
        } else {
          try { window.open(url, "_blank"); } catch (e) { }
        }
      });
    }).catch(function (err) {
      done();
      var msg;
      if (err && err.name === "AbortError") {
        msg = "请求超时，换个网络再试试";
      } else if (err && err.message === "ratelimit") {
        msg = "GitHub 接口被限流了（每小时有次数上限）" +
          (err.waitMin ? "，约 " + err.waitMin + " 分钟后恢复" : "");
      } else {
        msg = (err && err.message) || "网络不通";
      }
      toast("检查更新失败：" + msg, 3800);
    });
  }

  /* ==================================================================
     长期记忆：把超出上下文窗口的旧对话压缩成摘要
     否则聊过 30 条之后，前面发生的事就彻底丢了，角色只能靠一句设定硬撑。
     ================================================================== */
  var summarizing = {};

  function maybeUpdateMemory(session) {
    if (!settings.autoMemory) return;
    if (!settings.apiKey) return;
    if (!session || summarizing[session.id]) return;

    // 展开成 user / assistant 序列（只取当前选中的版本）
    var msgs = [];
    (session.messages || []).forEach(function (turn) {
      var edit = turn.edits && (turn.edits[turn.activeEdit] || turn.edits[0]);
      if (!edit) return;
      if (edit.text) msgs.push({ role: "user", content: edit.text });
      var rep = edit.replies[edit.activeReply] || edit.replies[0];
      if (rep && rep.content && !rep.error) {
        msgs.push({ role: "assistant", content: rep.content });
      }
    });

    var covered = session.memoryCovered || 0;

    // 按实际字数判断是否接近预算——没超之前一律发原文，效果最好
    var budgetChars = parseInt(settings.contextBudget, 10) || 120000;
    var totalChars = 0;
    for (var i = covered; i < msgs.length; i++) {
      totalChars += String(msgs[i].content || "").length;
    }
    if (totalChars <= budgetChars * 0.85) return;

    // 超了就砍掉最前面一段，留出 60% 预算的空间，避免频繁触发
    var target = budgetChars * 0.6;
    var sum = 0;
    var cut = msgs.length;
    for (var j = msgs.length - 1; j >= covered; j--) {
      var len = String(msgs[j].content || "").length;
      if (sum + len > target) break;
      sum += len;
      cut = j;
    }
    if (cut <= covered || cut - covered < 6) return;

    var chunk = msgs.slice(covered, cut);
    summarizing[session.id] = true;

    var body = chunk.map(function (m) {
      var who = m.role === "user" ? "用户" : "角色";
      return who + "：" + String(m.content).slice(0, 600);
    }).join("\n");

    var prompt = [
      {
        role: "system",
        content: "你在帮一段角色扮演对话整理长期记忆。只输出记忆内容本身，不要解释、不要寒暄、不要加标题。"
      },
      {
        role: "user",
        content:
          "【已有记忆】\n" + (session.memory || "（暂无）") +
          "\n\n【新发生的对话】\n" + body +
          "\n\n请合并成一份新的记忆，300 字以内。必须保留：\n" +
          "1. 用户的称呼、性格、喜好\n" +
          "2. 已经发生的关键事件、约定\n" +
          "3. 角色对用户的态度与关系变化\n" +
          "旧记忆里过时的内容直接改写，不要简单追加。"
      }
    ];

    API.complete(settings, prompt, 700).then(function (text) {
      var clean = String(text || "").trim();
      if (!clean) return;
      session.memory = clean.slice(0, 1500);
      session.memoryCovered = cut;
      Store.save();

      // 如果正在看这个对话的角色面板，同步显示
      var cur = getSession();
      if (cur && cur.id === session.id && $("personaSheet").classList.contains("open")) {
        $("personaMemory").value = session.memory;
      }
    }).catch(function () {
      // 记忆整理失败不影响聊天
    }).then(function () {
      summarizing[session.id] = false;
    });
  }

  function checkNotice() {
    $("notice").hidden = !!settings.agreedNotice;
  }

  function agreeNotice() {
    settings.agreedNotice = true;
    Store.saveImmediate();
    $("notice").hidden = true;
  }

  /* ==================================================================
     原生外壳（安卓返回键）
     ================================================================== */
  function setupNativeBack() {
    if (!isNative()) return;
    try {
      var AppPlugin = window.Capacitor.Plugins.App;
      if (!AppPlugin || !AppPlugin.addListener) return;
      AppPlugin.addListener("backButton", function () {
        // 公告未同意前不响应返回键
        if ($("notice") && $("notice").hidden === false) return;
        if ($("modal").hidden === false) {
          var cancel = $("modalCancel");
          if (cancel) cancel.onclick();
          return;
        }
        if ($("cropper").classList.contains("open")) {
          closeCropper();
          return;
        }
        if ($("importSheet").classList.contains("open")) {
          closeImport();
          return;
        }
        if ($("personaSheet").classList.contains("open")) {
          closePersona();
          return;
        }
        if ($("settingsSheet").classList.contains("open")) {
          closeSettings();
          return;
        }
        if ($("drawer").classList.contains("open")) {
          closeDrawer();
          return;
        }
        if (streaming) {
          stopGeneration();
          return;
        }
        try { AppPlugin.exitApp(); } catch (e) { }
      });
    } catch (e) { /* 插件不存在时忽略 */ }
  }

  /* ==================================================================
     启动
     ================================================================== */
  function boot() {
    updateViewport();

    function fatal(msg) {
      if (typeof window.__fatal === "function") window.__fatal(msg);
      else {
        try { document.title = "ERR " + msg; } catch (e) { }
      }
    }

    // 初始化最多等 2.2 秒；本地存储异常时用临时状态先把界面点亮
    var timer = setTimeout(function () { timer = null; }, 0);
    var timeoutPromise = new Promise(function (resolve) {
      timer = setTimeout(function () { resolve(null); }, 2200);
    });

    Promise.race([Store.init(), timeoutPromise]).then(function (st) {
      if (timer) { clearTimeout(timer); timer = null; }

      if (!st) {
        // 超时兜底：界面可用，但可能无法持久化
        st = Store.state || Store.defaultState();
        if (!Store.state) Store.state = st;
        fatal("提示：本地存储响应超时，已用临时模式启动（本次对话可能无法保存）");
      }

      state = st;
      settings = st.settings || Store.defaultSettings();
      applyTheme();

      // 修正非法 activeId
      if (state.activeId) {
        var exists = false;
        for (var i = 0; i < state.sessions.length; i++) {
          if (state.sessions[i].id === state.activeId) exists = true;
        }
        if (!exists) state.activeId = state.sessions.length ? state.sessions[0].id : null;
      }

      renderMessages();
      renderTopbar();
      renderDrawer();
      syncSettingsUI();
      updateSendState();
      // 打开就先停在最新一条，不然要往下滑很久
      snapToBottom();
      bindEvents();
      setupNativeBack();
      checkNotice();
      renderAttachments();

      // 启动后自检一次，防止某些设备上出现「透明遮罩」挡住点击
      setTimeout(function () {
        try { auditOverlays(); } catch (e) { }
      }, 400);
      setTimeout(function () {
        try { auditOverlays(); } catch (e) { }
      }, 1600);

      if (window.__bootTimer) { clearTimeout(window.__bootTimer); window.__bootTimer = null; }
      window.__ready = true;

      try { history.pushState(null, ""); } catch (e) { }

      // 启动快照（每日一份足够）
      try { Store.createSnapshot(); } catch (e) { }

      // PWA：只在浏览器环境注册 Service Worker；
      // 原生外壳里必须注销，否则升级 APK 后可能一直读到旧缓存
      if ("serviceWorker" in navigator) {
        if (isNative()) {
          navigator.serviceWorker.getRegistrations().then(function (list) {
            for (var i = 0; i < list.length; i++) list[i].unregister();
          }).catch(function () { });
        } else if (location.protocol === "http:" || location.protocol === "https:") {
          navigator.serviceWorker.register("sw.js").catch(function () { });
        }
      }
    }).catch(function (err) {
      fatal("启动失败：" + (err && err.message ? err.message : err));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
