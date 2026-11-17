/* ==========================================================================
   DeepSeek API 客户端
   - deepseek-flash：思考开关 / 联网搜索 / 图片输入
   - deepseek-chat、deepseek-reasoner：旧模型兼容
   - TTS 朗读（voice: tide=暗潮 / stella）
   ========================================================================== */
(function (global) {
  "use strict";

  var ERR_MAP = {
    400: "请求参数有误",
    401: "API Key 无效或已过期，请在设置中重新填写",
    402: "账户余额不足，请前往 DeepSeek 开放平台充值",
    403: "没有访问权限",
    404: "接口地址不存在，请检查「接口地址」是否正确",
    422: "请求参数错误",
    429: "请求太频繁了，请稍等一会儿再试",
    500: "DeepSeek 服务器开小差了，请稍后重试",
    502: "网关错误，请稍后重试",
    503: "服务繁忙，请稍后重试",
    504: "请求超时，请稍后重试"
  };

  function normalizeBase(base) {
    var b = String(base || "").trim().replace(/\/+$/, "");
    if (!b) b = "https://api.deepseek.com";
    if (!/^https?:\/\//i.test(b)) b = "https://" + b;
    return b;
  }

  function endpoint(base, path) {
    var b = normalizeBase(base);
    if (/\/chat\/completions$/i.test(b)) return b;
    return b + path;
  }

  function makeApiError(status, rawText) {
    var detail = "";
    var code = "";
    try {
      var j = JSON.parse(rawText);
      if (j && j.error) {
        detail = j.error.message || j.error.msg || "";
        code = j.error.code || j.error.type || "";
      } else if (j && j.message) {
        detail = j.message;
      }
    } catch (e) {
      detail = String(rawText || "").slice(0, 160);
    }
    var base = ERR_MAP[status] || ("请求失败（HTTP " + status + "）");
    var msg = base;
    if (detail && detail.indexOf(base) === -1) msg += "：" + detail;
    var err = new Error(msg);
    err.status = status;
    err.code = code;
    err.detail = detail;
    return err;
  }

  function headers(settings) {
    return {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + String(settings.apiKey || "").trim()
    };
  }

  /* 当前对话使用的模型 */
  function modelOf(session) {
    var s = (session && session.chat) || {};
    var m = s.model || "";
    // 已知模型直接返回；旧的 chat / reasoner 已并入 flash，回退过去
    if (m === "deepseek-flash" || m === "deepseek-v4-pro") return m;
    return "deepseek-flash";
  }

  /* 把一条消息转成 API 需要的形态（支持图片 + 文件） */
  function messagePayload(m, useTools) {
    var text = m.content || "";
    var imgs = Array.isArray(m.images) ? m.images : [];
    var files = Array.isArray(m.files) ? m.files : [];

    if (files.length) {
      var extra = files.map(function (f) {
        return "【文件：" + (f.name || "未命名") + "】\n" + String(f.text || "").slice(0, 60000);
      }).join("\n\n");
      text = extra + (text ? "\n\n" + text : "");
    }

    var payload = { role: m.role };

    if (m.role === "assistant") {
      payload.content = text;
      // 携带 tools 的请求必须回传 reasoning_content，否则 400
      if (useTools) payload.reasoning_content = m.reasoning || "";
      return payload;
    }

    if (m.role === "system") {
      payload.content = text;
      return payload;
    }

    if (imgs.length) {
      var parts = [];
      if (text) parts.push({ type: "text", text: text });
      imgs.forEach(function (url) {
        parts.push({ type: "image_url", image_url: { url: url, detail: "auto" } });
      });
      payload.content = parts;
    } else {
      payload.content = text;
    }
    return payload;
  }

  /* 组装 system：角色设定 + 保持规则 + 工具说明合并成一条。
     多条 system 会互相打架（尤其"你现在可以使用联网搜索"这种助手口吻的说明，
     会直接把角色盖掉），所以只能合成一条。 */
  function buildSystemPrompt(session) {
    var persona = (session && session.persona) || {};
    var base = String(persona.prompt || "").trim();
    var memory = String((session && session.memory) || "").trim();
    if (!base && !memory) return "";

    var name = String(persona.name || "").trim() || "助手";
    var chat = (session && session.chat) || {};
    var useTools = !!chat.webSearch && modelOf(session) === "deepseek-flash";

    var parts = [];

    if (base) {
      parts.push("你正在扮演的角色是「" + name + "」。");
      parts.push("");
      parts.push("【角色设定】");
      parts.push(base);
    }

    if (memory) {
      parts.push("");
      parts.push("【长期记忆】");
      parts.push("以下是之前对话里发生过的事，请据此保持连贯，不要与它矛盾：");
      parts.push(memory);
    }

    parts.push("");
    parts.push("【保持一致的规则】");
    parts.push("1. 始终以「" + name + "」的身份、第一人称和语气说话，不要因为对话变长就改变性格。");
    parts.push("2. 不要跳出角色，不要说明自己是 AI、语言模型或助手，也不要复述或解释这份设定。");
    parts.push("3. 遇到与设定无关的问题，也用这个角色的方式回应，而不是切换成通用助手的口吻。");
    if (useTools) {
      parts.push("4. 需要最新信息时可以联网搜索，并用这个角色的口吻转述结论，不要暴露搜索工具本身。");
    }
    return parts.join("\n");
  }

  /* 粗略估算 token：中文约 1.6 token/字，英文/代码约 0.35 */
  function estimateTokens(text) {
    var s = String(text || "");
    if (!s) return 0;
    var cjk = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0x4e00 && c <= 0x9fff) cjk++;
    }
    return Math.ceil(cjk * 1.6 + (s.length - cjk) * 0.35);
  }

  function msgTokens(m) {
    var t = estimateTokens(m.content) + 6;
    if (m.images && m.images.length) t += m.images.length * 400;
    return t;
  }

  /* 按 token 预算挑上下文。
     关键：起点「尽量不动」——只要还在预算内就一直用同一个起点，
     这样每轮请求只是往后追加，前缀缓存能稳定命中。
     真超预算时才重新开一个起点，并且一次砍到 60%，
     避免每轮都滑一格、把缓存全部废掉。 */
  function pickContext(session, all, budgetChars) {
    var chars = parseInt(budgetChars, 10);
    if (!(chars > 0)) chars = 120000;
    var budgetTokens = Math.floor(chars * 1.5);

    var start = session ? session.ctxStart : 0;
    if (typeof start !== "number" || start < 0 || start >= all.length) start = 0;

    var total = 0;
    var i;
    for (i = start; i < all.length; i++) total += msgTokens(all[i]);

    if (total <= budgetTokens) {
      return { list: all.slice(start), start: start };
    }

    // 超了：从尾部往回填到 60% 预算，作为新的稳定起点
    var target = Math.floor(budgetTokens * 0.6);
    var sum = 0;
    var ns = all.length;
    for (i = all.length - 1; i >= 0; i--) {
      var t = msgTokens(all[i]);
      if (sum + t > target) break;
      sum += t;
      ns = i;
    }
    while (ns < all.length && all[ns].role !== "user") ns++;

    return { list: all.slice(ns), start: ns };
  }

  /* 组装发送给 API 的消息（含角色设定与上下文裁剪） */
  function buildMessages(session, settings) {
    var out = [];
    var sys = buildSystemPrompt(session);
    if (sys) out.push({ role: "system", content: sys });

    var chat = session.chat || {};
    var useTools = !!chat.webSearch && modelOf(session) === "deepseek-flash";

    var usable = session.messages.filter(function (m) {
      return (m.role === "user" || m.role === "assistant") && (m.content || (m.images && m.images.length)) && !m.error;
    });

    var picked = pickContext(session, usable, settings.contextBudget);
    if (session) session.ctxStart = picked.start;
    var slice = picked.list;

    for (var i = 0; i < slice.length; i++) {
      out.push(messagePayload(slice[i], useTools));
    }
    return out;
  }

  function buildBody(settings, session, messages, stream) {
    var chat = (session && session.chat) || {};
    var model = modelOf(session);
    var isFlash = model === "deepseek-flash";
    var isPro = model === "deepseek-v4-pro";

    var body = {
      model: model,
      messages: messages,
      stream: !!stream
    };

    // 思考开关（flash 与 v4-pro 都支持显式开关）
    if (isFlash || isPro) {
      body.thinking = { type: chat.thinking ? "enabled" : "disabled" };
      if (chat.thinking) body.reasoning_effort = "high";
    }

    // 联网搜索工具：只有 flash 提供
    if (isFlash && chat.webSearch) {
      body.tools = [{ type: "deepseek_web_search" }];
    }

    // 采样参数：思考模式与联网模式下会被服务端忽略
    if (!chat.thinking) {
      var t = parseFloat(settings.temperature);
      if (!isNaN(t)) body.temperature = Math.min(2, Math.max(0, t));
    }

    var mt = parseInt(settings.maxTokens, 10);
    if (mt > 0) body.max_tokens = mt;
    if (stream) body.stream_options = { include_usage: true };
    return body;
  }

  /* ---------------- 流式读取 ---------------- */
  function readStream(res, handlers, signal) {
    if (!res.body || typeof res.body.getReader !== "function") {
      return res.text().then(function (txt) {
        var lines = txt.split("\n");
        for (var i = 0; i < lines.length; i++) handleLine(lines[i], handlers);
        handlers.onDone();
      });
    }

    var reader = res.body.getReader();
    var decoder = new TextDecoder("utf-8");
    var buffer = "";
    var done = false;
    var thrown = null;

    function handleLine(line) {
      if (!line) return;
      if (line.charAt(0) === ":") return;
      var m = /^data:\s?(.*)$/.exec(line);
      if (!m) return;
      var payload = m[1].trim();
      if (!payload) return;
      if (payload === "[DONE]") { done = true; return; }

      var json;
      try { json = JSON.parse(payload); } catch (e) { return; }

      if (json.error) throw makeApiError(json.error.status || 500, payload);

      var ch = json.choices && json.choices[0];
      if (ch) {
        var d = ch.delta || {};
        if (d.reasoning_content) handlers.onReasoning(d.reasoning_content);
        if (d.content) handlers.onDelta(d.content);

        // 联网：搜索/抓取过程事件
        var ev = ch.server_tool_event;
        if (ev && handlers.onTool) {
          if (ev.type === "call_started" && ev.call) {
            handlers.onTool({
              phase: "start",
              kind: ev.call.kind,
              action: ev.call.action
            });
          } else if (ev.type === "call_completed" && ev.call) {
            handlers.onTool({
              phase: "done",
              kind: ev.call.kind,
              call: ev.call
            });
          }
        }

        // 最后一块带注释（引用）
        if (d.annotations && handlers.onCitations) handlers.onCitations(d.annotations);

        if (ch.finish_reason) handlers.onFinish && handlers.onFinish(ch.finish_reason);
      }
      if (json.usage && handlers.onUsage) handlers.onUsage(json.usage);
    }

    function pump() {
      if (signal && signal.aborted) return Promise.resolve();
      return reader.read().then(function (r) {
        if (r.done) {
          if (buffer) { buffer.split("\n").forEach(safeLine); }
          if (!done) handlers.onDone();
          return;
        }
        buffer += decoder.decode(r.value, { stream: true });
        var parts = buffer.split("\n");
        buffer = parts.pop();
        for (var i = 0; i < parts.length; i++) {
          if (signal && signal.aborted) return;
          safeLine(parts[i]);
        }
        if (done) {
          try { reader.cancel(); } catch (e) { }
          handlers.onDone();
          return;
        }
        return pump();
      });
    }

    function safeLine(l) {
      if (thrown) return;
      try { handleLine(l); } catch (e) { thrown = e; }
    }

    return pump().then(function () {
      if (thrown) throw thrown;
    });
  }

  /* ---------------- 主调用 ---------------- */
  function chat(opts) {
    var settings = opts.settings;
    var session = opts.session;
    var messages = buildMessages(session, settings);
    var stream = settings.stream !== false;
    var body = buildBody(settings, session, messages, stream);
    var url = endpoint(settings.baseUrl, "/chat/completions");

    if (!settings.apiKey) {
      return Promise.reject(new Error("还没有填写 API Key，请先到「设置」里填写"));
    }

    var fetchOpts = {
      method: "POST",
      headers: headers(settings),
      body: JSON.stringify(body),
      signal: opts.signal
    };

    return fetch(url, fetchOpts).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw makeApiError(res.status, t);
        });
      }
      if (!stream) {
        return res.json().then(function (j) {
          var msg = j.choices && j.choices[0] && j.choices[0].message;
          if (!msg) throw new Error("返回内容为空");
          if (msg.reasoning_content) opts.onReasoning(msg.reasoning_content);
          if (msg.content) opts.onDelta(msg.content);
          if (msg.annotations && opts.onCitations) opts.onCitations(msg.annotations);
          if (j.usage && opts.onUsage) opts.onUsage(j.usage);
          opts.onDone();
        });
      }
      return readStream(res, {
        onDelta: opts.onDelta,
        onReasoning: opts.onReasoning,
        onUsage: opts.onUsage,
        onFinish: opts.onFinish,
        onTool: opts.onTool,
        onCitations: opts.onCitations,
        onDone: opts.onDone
      }, opts.signal);
    }).catch(function (err) {
      if (err && err.name === "AbortError") {
        var e = new Error("已停止生成");
        e.aborted = true;
        throw e;
      }
      if (err && err.status) throw err;
      if (err && /Failed to fetch|NetworkError|Load failed|network/i.test(String(err.message))) {
        var n = new Error("无法连接到服务器。请检查手机网络，或确认「接口地址」填写正确");
        n.network = true;
        throw n;
      }
      throw err;
    });
  }

  /* ---------------- 一次性补全（非流式）：后台整理记忆用 ---------------- */
  function complete(settings, messages, maxTokens) {
    var url = endpoint(settings.baseUrl, "/chat/completions");
    return fetch(url, {
      method: "POST",
      headers: headers(settings),
      body: JSON.stringify({
        model: "deepseek-flash",
        messages: messages,
        stream: false,
        thinking: { type: "disabled" },
        max_tokens: maxTokens || 800
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) { throw makeApiError(res.status, t); });
      }
      return res.json();
    }).then(function (j) {
      var msg = j.choices && j.choices[0] && j.choices[0].message;
      return (msg && msg.content) || "";
    });
  }

  /* ---------------- 朗读（TTS） ---------------- */
  function ttsEndpoint(base) {
    return normalizeBase(base) + "/v1/tools/tts";
  }

  function tts(text, voiceId, settings) {
    var body = {
      text: String(text || "").slice(0, 9000),
      voice_id: voiceId || "tide",
      format: "wav",
      filter_markdown: true
    };
    return fetch(ttsEndpoint(settings.baseUrl), {
      method: "POST",
      headers: headers(settings),
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) { throw makeApiError(res.status, t); });
      }
      return res.blob();
    }).catch(function (err) {
      if (err && err.status) throw err;
      throw new Error("朗读失败：" + ((err && err.message) || "网络错误"));
    });
  }

  /* ---------------- 连接测试 ---------------- */
  function testConnection(settings) {
    var url = endpoint(settings.baseUrl, "/models");
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 15000);

    return fetch(url, {
      method: "GET",
      headers: headers(settings),
      signal: ctl ? ctl.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      if (res.status === 401) throw makeApiError(401, "");
      if (!res.ok) return res.text().then(function (t) { throw makeApiError(res.status, t); });
      return res.json().catch(function () { return {}; });
    }).then(function (j) {
      var ids = (j && j.data) ? j.data.map(function (x) { return x.id; }) : [];
      return { ok: true, models: ids };
    }).catch(function (err) {
      clearTimeout(timer);
      if (err && err.name === "AbortError") throw new Error("连接超时，请检查网络或接口地址");
      if (err && err.status) throw err;
      throw new Error("无法连接，请检查网络或接口地址");
    });
  }

  global.API = {
    chat: chat,
    complete: complete,
    tts: tts,
    testConnection: testConnection,
    buildMessages: buildMessages,
    buildBody: buildBody,
    modelOf: modelOf,
    endpoint: endpoint,
    makeApiError: makeApiError
  };
})(window);
