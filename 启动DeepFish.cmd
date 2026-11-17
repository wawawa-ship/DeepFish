@echo off
chcp 65001 >nul
title DeepFish
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto NONODE

set PORT=5180
echo.
echo   DeepFish  ·  DeepSeek 手机助手
echo   ----------------------------------------
echo   本地地址: http://127.0.0.1:%PORT%/
echo   手机访问: 用手机浏览器打开  http://电脑IP:%PORT%/
echo   关闭窗口即可停止服务
echo   ----------------------------------------
echo.

start "" "http://127.0.0.1:%PORT%/"
node "tools\serve.js"
goto END

:NONODE
echo.
echo   [!] 未检测到 Node.js
echo.
echo   请先安装 Node.js（LTS 版本）: https://nodejs.org/
echo   安装完成后重新双击本文件即可。
echo.
pause

:END
