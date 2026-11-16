#!/usr/bin/env node
/**
 * 准备运行时资源（npm install 后自动执行，也可手动运行 npm run setup-assets）：
 * 1. 把 @mediapipe/tasks-vision 的 WASM 文件复制到 public/mediapipe/wasm/（版本与 JS 包保持一致）；
 * 2. public/mediapipe/face_landmarker.task 不存在时从 Google 官方地址下载。
 * 运行时所有文件都从本地加载，不依赖 CDN。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 用 fileURLToPath 处理含中文等非 ASCII 字符的路径
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const dstDir = path.join(root, 'public/mediapipe/wasm');
const task = path.join(root, 'public/mediapipe/face_landmarker.task');
const TASK_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

if (fs.existsSync(srcDir)) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const f of fs.readdirSync(srcDir)) fs.copyFileSync(path.join(srcDir, f), path.join(dstDir, f));
  console.log(`[setup-assets] 已复制 MediaPipe WASM → public/mediapipe/wasm/`);
} else {
  console.warn('[setup-assets] 没有找到 node_modules/@mediapipe/tasks-vision，请先运行 npm install');
}

if (fs.existsSync(task) && fs.statSync(task).size > 1_000_000) {
  console.log('[setup-assets] face_landmarker.task 已存在');
} else {
  try {
    const res = await fetch(TASK_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(task, Buffer.from(await res.arrayBuffer()));
    console.log('[setup-assets] 已下载 face_landmarker.task');
  } catch (err) {
    console.warn(`[setup-assets] face_landmarker.task 下载失败（${err.message}）。请手动下载：\n  ${TASK_URL}\n  放到 public/mediapipe/face_landmarker.task`);
  }
}
