@echo off
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 echo [错误] 未检测到 Node.js — 请先安装 Node.js 18+: https://nodejs.org/ && pause && exit /b 1
rem 第90轮: 版本门禁 — 项目需要 Node 18+ (旧版本语法/内置模块不兼容)
for /f "tokens=*" %%v in ('node -v') do set NODEV=%%v
echo Node %NODEV% 检测通过 — 启动中...
node "%~dp0tools\start.js" %*
