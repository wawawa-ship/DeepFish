/* ==========================================================================
   轻量 Markdown 渲染器（无依赖、防 XSS）
   支持：标题 / 段落 / 粗斜体 / 删除线 / 行内代码 / 代码块 / 引用 /
         有序无序列表（含嵌套）/ 表格 / 分割线 / 链接 / 自动链接
   ========================================================================== */
(function (global) {
  "use strict";

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  var COPY_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/>' +
    '<path d="M5 15V5a1 1 0 011-1h10"/></svg>';

  function safeUrl(u) {
    var s = String(u).trim();
    if (/^\s*(javascript|data|vbscript|file)\s*:/i.test(s)) return "#";
    return s;
  }

  /* ---------------- 行内解析 ---------------- */
  function inline(text) {
    var src = escapeHtml(text);
    var tokens = [];

    function tok(html) {
      tokens.push(html);
      return "\u0000" + (tokens.length - 1) + "\u0000";
    }

    // 1. 行内代码
    src = src.replace(/`([^`\n]+)`/g, function (_, code) {
      return tok("<code>" + code + "</code>");
    });

    // 2. 图片（降级为链接，移动端不自动加载外链图）
    src = src.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, alt, url) {
      return tok('<a href="' + safeUrl(url) + '" target="_blank" rel="noopener noreferrer">🖼 ' +
        (alt || "图片") + "</a>");
    });

    // 3. Markdown 链接
    src = src.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (_, t, url) {
      return tok('<a href="' + safeUrl(url) + '" target="_blank" rel="noopener noreferrer">' + t + "</a>");
    });

    // 4. 自动识别裸链接
    src = src.replace(/(^|[\s(（])((?:https?:\/\/)[^\s<>"'）】，。；！？、]+)/g,
      function (_, pre, url) {
        var tail = url.replace(/[.,;:!?]+$/, "");
        var rest = url.slice(tail.length);
        return pre + tok('<a href="' + safeUrl(tail) + '" target="_blank" rel="noopener noreferrer">' +
          tail + "</a>") + rest;
      });

    // 5. 粗体 / 斜体 / 删除线
    src = src.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
    src = src.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    src = src.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    src = src.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    src = src.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    src = src.replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");

    // 6. 还原 token
    src = src.replace(/\u0000(\d+)\u0000/g, function (_, i) {
      return tokens[+i] || "";
    });

    return src;
  }

  /* ---------------- 代码块 ---------------- */
  function renderCodeBlock(lang, text) {
    var label = (lang || "text").toLowerCase();
    return '<pre><div class="code-head"><span>' + escapeHtml(label) + "</span>" +
      '<button class="code-copy" type="button" data-code="1">' + COPY_SVG + "复制</button>" +
      "</div><code>" + escapeHtml(text) + "</code></pre>";
  }

  /* ---------------- 表格 ---------------- */
  function isTableSep(line) {
    if (!line) return false;
    if (line.indexOf("|") === -1 && line.indexOf("-") === -1) return false;
    return /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/.test(line);
  }

  function splitRow(line) {
    var s = line.trim();
    if (s.charAt(0) === "|") s = s.slice(1);
    if (s.charAt(s.length - 1) === "|") s = s.slice(0, -1);
    return s.split("|").map(function (c) { return c.trim(); });
  }

  function renderTable(head, aligns, rows) {
    var html = '<div class="table-wrap"><table><thead><tr>';
    for (var i = 0; i < head.length; i++) {
      var a = aligns[i] ? ' style="text-align:' + aligns[i] + '"' : "";
      html += "<th" + a + ">" + inline(head[i]) + "</th>";
    }
    html += "</tr></thead><tbody>";
    for (var r = 0; r < rows.length; r++) {
      html += "<tr>";
      for (var c = 0; c < head.length; c++) {
        var a2 = aligns[c] ? ' style="text-align:' + aligns[c] + '"' : "";
        html += "<td" + a2 + ">" + inline(rows[r][c] || "") + "</td>";
      }
      html += "</tr>";
    }
    return html + "</tbody></table></div>";
  }

  /* ---------------- 列表 ---------------- */
  function parseListItems(lines, start) {
    var items = [];
    var i = start;
    var baseIndent = -1;
    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) {
        // 空行：若后面还是列表项则继续，否则结束
        var j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && /^(\s*)([-*+]|\d+[.)])\s+/.test(lines[j])) {
          i = j;
          continue;
        }
        break;
      }
      var m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (m) {
        var indent = m[1].replace(/\t/g, "  ").length;
        if (baseIndent < 0) baseIndent = indent;
        items.push({
          level: Math.max(0, Math.round((indent - baseIndent) / 2)),
          ordered: /\d/.test(m[2]),
          text: m[3]
        });
        i++;
      } else if (/^\s{2,}\S/.test(line) && items.length) {
        // 续行
        items[items.length - 1].text += "\n" + line.trim();
        i++;
      } else {
        break;
      }
    }
    return { items: items, next: i };
  }

  function buildTree(items) {
    var root = { children: [] };
    var stack = [{ level: -1, node: root }];
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      while (stack.length > 1 && stack[stack.length - 1].level >= it.level) stack.pop();
      var node = { text: it.text, ordered: it.ordered, children: [] };
      stack[stack.length - 1].node.children.push(node);
      stack.push({ level: it.level, node: node });
    }
    return root.children;
  }

  function renderTree(nodes) {
    if (!nodes.length) return "";
    var tag = nodes[0].ordered ? "ol" : "ul";
    var html = "<" + tag + ">";
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      html += "<li>" + inline(n.text);
      if (n.children.length) html += renderTree(n.children);
      html += "</li>";
    }
    return html + "</" + tag + ">";
  }

  /* ---------------- 块级解析 ---------------- */
  function isBlockStart(line) {
    if (/^\s*#{1,6}\s+/.test(line)) return true;
    if (/^\s*>/.test(line)) return true;
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) return true;
    if (/^\s*```/.test(line)) return true;
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) return true;
    if (/^\s*<\/?[a-z]/.test(line)) return true;
    return false;
  }

  function renderTextBlock(text) {
    var lines = text.split("\n");
    var html = "";
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (!line.trim()) { i++; continue; }

      // 标题
      var h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        var lv = h[1].length;
        html += "<h" + lv + ">" + inline(h[2].trim().replace(/\s+#+\s*$/, "")) + "</h" + lv + ">";
        i++;
        continue;
      }

      // 分割线
      if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
        html += "<hr>";
        i++;
        continue;
      }

      // 引用
      if (/^\s*>/.test(line)) {
        var q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          q.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        }
        html += "<blockquote>" + renderTextBlock(q.join("\n")) + "</blockquote>";
        continue;
      }

      // 表格
      if (line.indexOf("|") !== -1 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        var head = splitRow(line);
        var aligns = splitRow(lines[i + 1]).map(function (c) {
          var l = c.charAt(0) === ":";
          var r = c.charAt(c.length - 1) === ":";
          if (l && r) return "center";
          if (r) return "right";
          if (l) return "left";
          return "";
        });
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].indexOf("|") !== -1) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        html += renderTable(head, aligns, rows);
        continue;
      }

      // 列表
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        var res = parseListItems(lines, i);
        if (res.items.length) {
          html += renderTree(buildTree(res.items));
        }
        i = Math.max(res.next, i + 1);
        continue;
      }

      // 缩进代码块（4 空格）
      if (/^ {4}\S/.test(line)) {
        var codeLines = [];
        while (i < lines.length && (/^ {4}/.test(lines[i]) || !lines[i].trim())) {
          if (!lines[i].trim() && !(i + 1 < lines.length && /^ {4}/.test(lines[i + 1]))) break;
          codeLines.push(lines[i].replace(/^ {4}/, ""));
          i++;
        }
        html += renderCodeBlock("", codeLines.join("\n"));
        continue;
      }

      // 段落
      var buf = [];
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i]) &&
        !(lines[i].indexOf("|") !== -1 && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
        buf.push(lines[i]);
        i++;
      }
      if (buf.length) {
        html += "<p>" + inline(buf.join("\n")).replace(/\n/g, "<br>") + "</p>";
      }
      if (buf.length === 0) i++;
    }

    return html;
  }

  /* ---------------- 主入口 ---------------- */
  function render(source) {
    var src = String(source == null ? "" : source).replace(/\r\n?/g, "\n");
    var lines = src.split("\n");
    var html = "";
    var buf = [];
    var inCode = false;
    var codeLang = "";
    var codeBuf = [];

    function flushText() {
      if (buf.length) {
        html += renderTextBlock(buf.join("\n"));
        buf = [];
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var fence = /^\s*```\s*([^\s`]*)\s*$/.exec(line);
      if (inCode) {
        if (fence) {
          html += renderCodeBlock(codeLang, codeBuf.join("\n"));
          inCode = false;
          codeLang = "";
          codeBuf = [];
        } else {
          codeBuf.push(line);
        }
      } else if (fence) {
        flushText();
        inCode = true;
        codeLang = fence[1] || "";
      } else {
        buf.push(line);
      }
    }

    if (inCode) html += renderCodeBlock(codeLang, codeBuf.join("\n"));
    flushText();
    return html;
  }

  global.MD = { render: render, escape: escapeHtml, inline: inline };
})(window);
