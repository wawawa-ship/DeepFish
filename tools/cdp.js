/* 轻量 CDP 驱动：启动 Edge 无头 → 打开页面 → 执行 JS / 截图
   用法：
     node cdp.js --url=http://127.0.0.1:5180/ --out=shot.png --w=390 --h=844 --dpr=3
                 --wait=2500 --eval="document.title" --eval="typeof Store"
*/
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function parseArgs() {
  const args = { w: 390, h: 844, dpr: 3, wait: 2500, evals: [], fullPage: false };
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (!m) continue;
    const k = m[1], v = m[2];
    if (k === "eval") args.evals.push(v);
    else if (k === "wait" || k === "w" || k === "h" || k === "dpr") args[k] = Number(v);
    else if (k === "fullPage") args.fullPage = v !== "false";
    else args[k] = v;
  }
  if (args.evalFile) {
    args.evals.unshift(fs.readFileSync(args.evalFile, "utf8"));
  }
  if (args.afterFile) {
    args.after = fs.readFileSync(args.afterFile, "utf8");
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.console = [];
    this.exceptions = [];
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    const c = new CDP(ws);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error("ws error"));
    });
    ws.onmessage = (e) => c._onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      for (const [, p] of c.pending) p.rej(new Error("ws closed"));
      c.pending.clear();
    };
    return c;
  }
  _onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.rej(new Error(msg.error.message));
      else p.res(msg.result);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      this.console.push({
        type: msg.params.type,
        text: (msg.params.args || []).map((a) => a.value !== undefined ? a.value : a.description).join(" ")
      });
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      this.exceptions.push((d.exception && d.exception.description) || d.text);
    }
    if (msg.method === "Log.entryAdded") {
      const e = msg.params.entry;
      if (e.level === "error" || e.level === "warning") {
        this.exceptions.push("[" + e.level + "] " + e.text + " " + (e.url || ""));
      }
    }
    this.events.push(msg);
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
}

async function getTarget(port) {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch("http://127.0.0.1:" + port + "/json/list");
      const list = await r.json();
      const page = list.find((t) => t.type === "page");
      if (page && page.webSocketDebuggerUrl) return page;
    } catch (e) { /* not ready */ }
    await sleep(150);
  }
  throw new Error("devtools not ready");
}

async function main() {
  const args = parseArgs();
  const port = 9200 + Math.floor(Math.random() * 500);
  const profile = path.join(os.tmpdir(), "edge-cdp-" + Date.now());

  const child = spawn(EDGE, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--hide-scrollbars",
    "--remote-debugging-port=" + port,
    "--user-data-dir=" + profile,
    "--window-size=" + args.w + "," + args.h,
    "about:blank"
  ], { stdio: "ignore" });

  let cdp;
  try {
    const target = await getTarget(port);
    cdp = await CDP.connect(target.webSocketDebuggerUrl);

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: args.w, height: args.h, deviceScaleFactor: args.dpr, mobile: true
    });
    if (args.touch) {
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    }
    if (args.dark) {
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: "dark" }]
      });
    } else {
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: "light" }]
      });
    }

    if (args.initScriptFile) {
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: fs.readFileSync(args.initScriptFile, "utf8")
      });
    }

    await cdp.send("Page.navigate", { url: args.url });
    await sleep(args.wait);
    if (args.wait2) await sleep(args.wait2);

    const results = [];
    for (const expr of args.evals) {
      try {
        const r = await cdp.send("Runtime.evaluate", {
          expression: expr, returnByValue: true, awaitPromise: true
        });
        results.push({ expr, value: r.result && r.result.value, desc: r.result && r.result.description });
      } catch (e) {
        results.push({ expr, error: e.message });
      }
    }

    if (args.reload) {
      await cdp.send("Page.reload", { ignoreCache: true });
      await sleep(Number(args.waitAfterReload || 2600));
    }

    if (args.after) {
      try {
        const r = await cdp.send("Runtime.evaluate", {
          expression: args.after, returnByValue: true, awaitPromise: true
        });
        results.push({ expr: "[after] " + args.after.slice(0, 80), value: r.result && r.result.value });
      } catch (e) {
        results.push({ expr: "[after] " + args.after.slice(0, 80), error: e.message });
      }
      await sleep(Number(args.afterWait || 600));
    }

    if (args.tapSel) {
      // 真实触摸点击：按选择器取元素中心点，派发 touch 事件（会走完整事件链）
      const rect = await cdp.send("Runtime.evaluate", {
        expression: "(function(){var el=document.querySelector(" + JSON.stringify(args.tapSel) +
          ");if(!el)return null;var b=el.getBoundingClientRect();" +
          "return JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2,w:b.width,h:b.height});})()",
        returnByValue: true
      });
      const raw = rect.result && rect.result.value;
      if (raw) {
        const pt = JSON.parse(raw);
        await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
        const tp = [{ x: Math.round(pt.x), y: Math.round(pt.y) }];
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp });
        await sleep(80);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        results.push({ expr: "[tap] " + args.tapSel, value: JSON.stringify(tp) });
      } else {
        results.push({ expr: "[tap] " + args.tapSel, value: "ELEMENT NOT FOUND" });
      }
      await sleep(Number(args.tapWait || 800));
    }

    if (args.out) {
      let clip;
      if (args.fullPage) {
        const m = await cdp.send("Page.getLayoutMetrics");
        const h = Math.ceil(m.cssContentSize.height);
        clip = { x: 0, y: 0, width: args.w, height: h, scale: 1 };
      }
      const shot = await cdp.send("Page.captureScreenshot", {
        format: "png", captureBeyondViewport: !!args.fullPage, clip
      });
      fs.mkdirSync(path.dirname(args.out), { recursive: true });
      fs.writeFileSync(args.out, Buffer.from(shot.data, "base64"));
    }

    console.log(JSON.stringify({
      ok: true,
      results,
      exceptions: cdp.exceptions.filter(Boolean),
      console: cdp.console.filter((c) => c.type === "error" || c.type === "warning")
    }, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.message, exec: cdp ? cdp.exceptions : [] }, null, 2));
  } finally {
    try { child.kill(); } catch (e) {}
    try { execSync("taskkill /PID " + child.pid + " /T /F", { stdio: "ignore" }); } catch (e) {}
  }
  process.exit(0);
}

main();
