#!/bin/bash
# macOS：双击运行。首次运行会自动安装依赖（需要已安装 Node.js 20 以上：https://nodejs.org）。
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js。请先从 https://nodejs.org 安装 LTS 版本，然后重新双击本文件。"
  read -r -p "按回车键关闭…" _
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "首次运行：正在安装依赖（约 1–3 分钟）…"
  npm install || { read -r -p "安装失败，按回车键关闭…" _; exit 1; }
fi
echo "正在启动，浏览器会自动打开 http://localhost:5173 （关闭本窗口即停止）"
npm run dev -- --open
