@echo off
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 echo [错误] 未检测到 Node.js — 请先安装 Node.js 18+: https://nodejs.org/ && pause && exit /b 1
node "%~dp0tools\start.js" %*
