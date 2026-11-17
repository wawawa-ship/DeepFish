# -*- coding: utf-8 -*-
"""统一升级版本号（用正则，避免引号转义问题）"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = "1.8.1"
VERSION_CODE = 13


def sub(rel, pattern, repl):
    path = os.path.join(ROOT, rel.replace("/", os.sep))
    text = io.open(path, encoding="utf-8").read()
    new = re.sub(pattern, repl, text)
    if new == text:
        print("  MISS", rel, pattern)
    else:
        io.open(path, "w", encoding="utf-8", newline="\n").write(new)
        print("  ok  ", rel)


print("setting version to", VERSION)
sub("www/js/app.js", r'var AppVersion = "[^"]+"', 'var AppVersion = "%s"' % VERSION)
sub("www/sw.js", r"deepfish-v[0-9]+\.[0-9]+\.[0-9]+", "deepfish-v%s" % VERSION)
sub("android/app/build.gradle", r"versionCode \d+", "versionCode %d" % VERSION_CODE)
sub("android/app/build.gradle", r'versionName "[^"]+"', 'versionName "%s"' % VERSION)
sub("package.json", r'"version": "[^"]+"', '"version": "%s"' % VERSION)
print("done")
