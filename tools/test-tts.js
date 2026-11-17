/* 验证朗读：请求地址、音色、去 Markdown */
(async function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var out = {};
  var log = [];

  var origFetch = window.fetch;
  window.fetch = function (url, opts) {
    log.push({ url: String(url), body: opts && opts.body ? String(opts.body) : "" });
    if (String(url).indexOf("/tools/tts") !== -1) {
      return Promise.resolve(new Response(new Uint8Array(64), {
        status: 200,
        headers: { "Content-Type": "audio/wav" }
      }));
    }
    return origFetch.apply(this, arguments);
  };

  var btn = document.querySelector('[data-act="speak"]');
  out.hasSpeakBtn = !!btn;
  out.btnText = btn ? btn.textContent.trim() : "";

  if (btn) {
    btn.click();
    await sleep(800);
  }

  out.calls = log.map(function (x) { return x.url; });
  var ttsCall = log.filter(function (x) { return x.url.indexOf("/tools/tts") !== -1; })[0];
  if (ttsCall) {
    var body = JSON.parse(ttsCall.body);
    out.voice = body.voice_id;
    out.format = body.format;
    out.textLen = body.text.length;
    out.noMarkdown = body.text.indexOf("**") === -1;
  }

  window.fetch = origFetch;
  return JSON.stringify(out);
})()
