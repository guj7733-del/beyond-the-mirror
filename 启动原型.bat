@echo off
chcp 65001 >nul
rem Windows：双击运行。首次运行会自动安装依赖（需要已安装 Node.js 20 以上：https://nodejs.org）。
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 没有找到 Node.js。请先从 https://nodejs.org 安装 LTS 版本，然后重新双击本文件。
  pause
  exit /b 1
)
if not exist node_modules (
  echo 首次运行：正在安装依赖（约 1-3 分钟）...
  call npm install || (pause & exit /b 1)
)
echo 正在启动，浏览器会自动打开 http://localhost:5173 （关闭本窗口即停止）
call npm run dev -- --open
