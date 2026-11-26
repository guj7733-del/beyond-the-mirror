#!/usr/bin/env node
/**
 * 端到端自检（自动启动 Vite + 用本机 Chrome 打开页面，模拟摄像头）。
 *
 *   npm run check:e2e                               # 用 Chrome 自带的假摄像头（彩色测试图，没有人脸）
 *   npm run check:e2e -- --video face.mjpeg         # 用一段人脸视频当摄像头（.mjpeg 或 .y4m），可检查面捕
 *   npm run check:e2e -- --video face.mjpeg --headed  # 显示浏览器窗口
 *
 * 视频转换示例（需要 ffmpeg）：
 *   ffmpeg -i face.mp4 -vf "scale=1280:720,fps=25" -q:v 4 -f mjpeg face.mjpeg
 *
 * 结果：终端打印每一项检查的 PASS / FAIL，截图与录屏保存在 e2e-output/。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const video = opt('--video') ? path.resolve(opt('--video')) : null;
const headed = args.includes('--headed');
const OUT = path.join(root, 'e2e-output');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const server = await createServer({ root, server: { port: 0, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`Vite: ${url}${video ? `\n摄像头视频: ${video}` : '\n摄像头: Chrome 假设备（无人脸，跳过面捕检查）'}`);

const launchArgs = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'];
if (video) launchArgs.push(`--use-file-for-fake-video-capture=${video}`);
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: !headed, args: launchArgs });
} catch {
  console.log('没有找到本机 Chrome，尝试 Playwright 自带的 Chromium（如失败请运行 npx playwright install chromium）');
  browser = await chromium.launch({ headless: !headed, args: launchArgs });
}
const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 }, acceptDownloads: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const videoRoute = '**/Videos/*.mp4';
const videoRequests = [];
let failLastVideo;
const lastVideo = new Promise((resolve) => { failLastVideo = resolve; });
await page.route(videoRoute, async (route) => {
  const file = new URL(route.request().url()).pathname.split('/').at(-1);
  videoRequests.push(file);
  if (file === '8.mp4' && videoRequests.filter((name) => name === file).length === 1) {
    await lastVideo;
    await route.abort();
    return;
  }
  await route.continue();
});
await page.addInitScript(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
});

const save = async (name, expr = 'window.bm.compositor.canvas') => {
  const data = await page.evaluate((e) => eval(e).toDataURL('image/png'), expr);
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
};

try {
  await page.goto(url);
  const feed = page.locator('.video-feed');
  const activePlayer = page.locator('.video-slide[data-active="true"] video');
  const firstPlayer = page.locator('video[aria-label="视频 1 / 8"]');
  const nextPlayer = page.locator('video[aria-label="视频 2 / 8"]');

  await page.getByText('正在缓存短视频（7 / 8）', { exact: true }).waitFor();
  await page.locator('.video-cache-screen').hover();
  await page.mouse.wheel(0, 600);
  check('条件 A：缓存未完成时显示进度且禁止滑动播放', await feed.count() === 0 && await activePlayer.count() === 0);
  failLastVideo();
  await page.getByText('部分视频缓存失败（7 / 8）', { exact: true }).waitFor();
  await page.getByRole('button', { name: '重试缓存' }).click();

  const videoPlaying = (index) => page.waitForFunction((number) => {
    const player = document.querySelector('.video-slide[data-active="true"] video');
    return player?.getAttribute('aria-label') === `视频 ${number} / 8`
      && !player.paused && player.currentTime > 0 && player.currentSrc.startsWith('blob:');
  }, index, { timeout: 10000 });
  await videoPlaying(1);
  check('条件 A：重试只下载缺失视频，缓存齐全后原生播放', videoRequests.length === 9 && videoRequests.at(-1) === '8.mp4');

  await page.waitForFunction(() => document.querySelector('video[aria-label="视频 2 / 8"]')?.readyState >= 2);
  await nextPlayer.evaluate((player) => { player.dataset.preloaded = 'true'; });
  const preloadPaused = await nextPlayer.evaluate((player) => player.paused);
  await feed.hover();
  await page.mouse.wheel(0, await feed.evaluate((element) => element.clientHeight));
  await videoPlaying(2);
  check('条件 A：滑动复用预载视频，上一条暂停', preloadPaused && await activePlayer.getAttribute('data-preloaded') === 'true' && await firstPlayer.evaluate((player) => player.paused));

  await page.unroute(videoRoute);
  await page.route(videoRoute, (route) => {
    videoRequests.push(new URL(route.request().url()).pathname);
    return route.abort();
  });
  await page.reload();
  await videoPlaying(1);
  for (let index = 2; index <= 8; index++) {
    await feed.evaluate((element, number) => { element.scrollTop = (number - 1) * element.clientHeight; }, index);
    await videoPlaying(index);
  }
  check('条件 A：刷新后八条视频都从缓存播放，无视频网络请求', videoRequests.length === 9);
  await feed.evaluate((element) => { element.scrollTop = 0; });
  await videoPlaying(1);

  // 1. 模型
  await page.waitForFunction(() => window.bm && ['ready', 'error'].includes(window.bm.store.get().avatar.status), null, { timeout: 90000 });
  const av = await page.evaluate(() => { const a = window.bm.store.get().avatar; return { status: a.status, placeholder: a.placeholder, counts: a.report?.counts, warnings: a.report?.warnings ?? [] }; });
  check('加载 Avatar 模型', av.status === 'ready' && !av.placeholder, `ARKit 直连 ${av.counts?.direct} / 回退 ${av.counts?.fallback} / 缺失 ${av.counts?.missing}`);
  for (const w of av.warnings) console.log(`      提示：${w}`);

  // 2. Avatar 渲染在右下角、背景透明
  await page.waitForTimeout(800);
  const cover = await page.evaluate(() => {
    const c = window.bm.renderer.canvas;
    const g = document.createElement('canvas');
    g.width = c.width; g.height = c.height;
    const x = g.getContext('2d'); x.drawImage(c, 0, 0);
    const d = x.getImageData(0, 0, g.width, g.height).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) opaque++;
    const corner = d[3];
    const rect = window.bm.compositor.avatarRectFor(window.bm.store.get().settings.layout);
    return { ratio: opaque / (d.length / 4), corner, rect, W: window.bm.compositor.width, H: window.bm.compositor.height };
  });
  check('Avatar 有像素且背景透明', cover.ratio > 0.05 && cover.corner === 0, `覆盖率 ${(cover.ratio * 100).toFixed(1)}%，左上角 alpha=${cover.corner}`);
  check('Avatar 位于画面右下角', cover.rect.x + cover.rect.w >= cover.W - 1 && cover.rect.y > cover.H * 0.3, `区域 x=${cover.rect.x.toFixed(0)} y=${cover.rect.y.toFixed(0)} w=${cover.rect.w.toFixed(0)} h=${cover.rect.h.toFixed(0)}`);
  await save('01_no_camera');

  // 3. 摄像头开 / 关
  await page.evaluate(() => window.bm.startCamera());
  await page.waitForFunction(() => window.bm.store.get().camera.status !== 'starting', null, { timeout: 20000 });
  const cam = await page.evaluate(() => window.bm.store.get().camera);
  check('开启摄像头', cam.status === 'on', cam.error ?? cam.size);
  await page.waitForFunction(() => ['ready', 'error'].includes(window.bm.store.get().tracker.status), null, { timeout: 90000 });
  const tr = await page.evaluate(() => window.bm.store.get().tracker);
  check('MediaPipe Face Landmarker 初始化', tr.status === 'ready', `${tr.delegate}${tr.error ? ' ' + tr.error : ''}`);

  // 4. 面捕（需要人脸视频）
  if (video) {
    const okFace = await page.waitForFunction(() => window.bm.store.get().tracker.face, null, { timeout: 20000 }).then(() => true, () => false);
    check('检测到人脸', okFace);
    const rows = [];
    for (let i = 0; i < 80; i++) {
      await page.waitForTimeout(100);
      rows.push(await page.evaluate(() => { const d = window.bm.debugState(); return { yaw: d.head.yaw, pitch: d.head.pitch, jaw: d.channels?.jawOpen ?? 0, blink: Math.max(d.channels?.eyeBlinkLeft ?? 0, d.channels?.eyeBlinkRight ?? 0), pres: d.presence }; }));
    }
    const range = (k) => Math.max(...rows.map((r) => r[k])) - Math.min(...rows.map((r) => r[k]));
    check('张嘴驱动 Avatar（jawOpen 有变化）', range('jaw') > 0.1, `变化幅度 ${range('jaw').toFixed(2)}`);
    check('眨眼驱动 Avatar（eyeBlink 有变化）', range('blink') > 0.3, `变化幅度 ${range('blink').toFixed(2)}`);
    check('头部姿态有输出', range('yaw') + range('pitch') > 0.02, `yaw 变化 ${(range('yaw') * 57.3).toFixed(1)}°，pitch 变化 ${(range('pitch') * 57.3).toFixed(1)}°`);
    const fps = await page.evaluate(() => window.bm.store.get().tracker);
    check('面捕帧率', fps.fps >= 10, `${fps.fps} fps，单帧 ${fps.ms} ms`);
    await save('02_camera_face');
  }

  // 5. 六级阶段：手动切换
  const stageRows = [];
  for (let s = 0; s <= 5; s++) {
    await page.evaluate((x) => window.bm.setManualStage(x), s);
    await page.waitForTimeout(900);
    const st = await page.evaluate(() => { const d = window.bm.debugState(); return { stage: window.bm.store.get().experiment.stage, droop: d.params.eyelidDroop, sat: d.params.saturation, dark: d.params.darkCircle, blink: Math.min(d.channels.eyeBlinkLeft, d.channels.eyeBlinkRight) }; });
    stageRows.push(st);
    await save(`03_stage${s}`);
    await save(`03_stage${s}_avatar`, 'window.bm.renderer.canvas');
  }
  check('手动切换 Stage 0–5', stageRows.every((r, i) => r.stage === i), stageRows.map((r) => `S${r.stage}:饱和${r.sat.toFixed(2)}`).join(' '));
  check('叠加规则：眨眼值不低于眼皮下垂下限', stageRows.every((r) => r.blink >= r.droop - 0.02), stageRows.map((r) => `${r.blink.toFixed(2)}≥${r.droop.toFixed(2)}`).join(' '));

  // 6. 计时自动进阶
  await page.evaluate(() => { window.bm.setManualStage(null); window.bm.updateSettings({ stageTimes: [0, 1, 2, 3, 4, 5] }); window.bm.resetExperiment(); window.bm.startExperiment(); });
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 6500) {
    seen.add(await page.evaluate(() => window.bm.store.get().experiment.stage));
    await page.waitForTimeout(100);
  }
  check('计时器按时间节点自动进入下一阶段', [0, 1, 2, 3, 4, 5].every((s) => seen.has(s)), `经过阶段 ${[...seen].join(',')}`);
  await page.evaluate(() => window.bm.pauseExperiment());
  const p1 = await page.evaluate(() => window.bm.store.get().experiment.time);
  await page.waitForTimeout(600);
  const p2 = await page.evaluate(() => window.bm.store.get().experiment.time);
  check('暂停后计时不再增加', Math.abs(p2 - p1) < 0.05);
  await page.evaluate(() => window.bm.resetExperiment());
  const rs = await page.evaluate(() => ({ t: window.bm.store.get().experiment.time, s: window.bm.store.get().experiment.stage, droop: window.bm.debugState().params.eyelidDroop }));
  check('重置：时间归零、回到 Stage 0', rs.t === 0 && rs.s === 0 && rs.droop === 0);

  // 7. 录制与导出
  await page.evaluate(() => window.bm.setManualStage(3));
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.evaluate(() => window.bm.startRecording());
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.bm.stopRecording());
  const rec = await dl;
  const recPath = path.join(OUT, rec.suggestedFilename());
  await rec.saveAs(recPath);
  check('录制演示视频', fs.statSync(recPath).size > 50_000, `${rec.suggestedFilename()}，${(fs.statSync(recPath).size / 1024).toFixed(0)} KB`);
  const dl2 = page.waitForEvent('download', { timeout: 60000 });
  await page.evaluate(() => window.bm.exportStageSheet());
  const sheet = await dl2;
  await sheet.saveAs(path.join(OUT, sheet.suggestedFilename()));
  check('导出六阶段立绘', true, sheet.suggestedFilename());

  // 8. 版本 A：Stage 0 就举着手机
  await page.evaluate(() => { window.bm.setVersion('A'); window.bm.setManualStage(0); });
  await page.waitForTimeout(900);
  const a0 = await page.evaluate(() => ({ phone: window.bm.avatar?.phone?.root.visible, mode: window.bm.avatar?.mode }));
  check('版本 A：Stage 0 起就举着手机', a0.phone === true && a0.mode === 'corner');
  await save('04_versionA_stage0');

  // 9. 版本 B：只有头部叠在脸上
  await page.evaluate(() => window.bm.setVersion('B'));
  await page.waitForTimeout(1200);
  const b = await page.evaluate(() => {
    const a = window.bm.avatar;
    const d = window.bm.debugState();
    return {
      mode: a.mode,
      phone: a.phone?.root.visible,
      hidden: a.bodyMeshes.filter((m) => !m.visible).length,
      body: a.bodyMeshes.length,
      clip: (a.clipMaterials[0]?.clippingPlanes ?? []).length,
      glasses: a.glasses.visible,
      hp: d.headPlacement,
    };
  });
  check('版本 B：切换为头部模式，身体网格隐藏、手机隐藏、下巴以下裁切', b.mode === 'head' && b.phone === false && b.hidden === b.body && b.clip === 1, `隐藏 ${b.hidden}/${b.body} 个身体网格`);
  check('版本 B：默认戴眼镜', b.glasses === true);
  if (video) {
    const okB = await page.waitForFunction(() => window.bm.debugState().headPlacement?.fromFace === true, null, { timeout: 15000 }).then(() => true, () => false);
    const hp = await page.evaluate(() => window.bm.debugState().headPlacement);
    check('版本 B：头部跟随人脸摆放', okB && !!hp, hp ? `脸宽 ${hp.faceW.toFixed(0)} px，缩放 ${hp.scale.toFixed(2)}` : '');
    if (hp) {
      const inside = (pt) => pt.x > hp.x && pt.x < hp.x + hp.w && pt.y > hp.y && pt.y < hp.y + hp.h;
      check('版本 B：用户的眼睛和下巴都在头部画面范围内', inside(hp.eye) && inside(hp.chin));
    }
    await save('05_versionB_face');
  } else {
    const hidden = await page.evaluate(() => window.bm.debugState().headPlacement);
    check('版本 B：摄像头开着但没有人脸时，头部隐藏', hidden === null);
    await page.evaluate(() => window.bm.stopCamera());
    await page.waitForTimeout(500);
    const hp = await page.evaluate(() => window.bm.debugState().headPlacement);
    check('版本 B：摄像头关闭时头部放在画面中央（预览用）', !!hp && hp.fromFace === false);
    await page.evaluate(() => window.bm.startCamera());
    await page.waitForTimeout(800);
  }
  for (let s = 0; s <= 5; s++) {
    await page.evaluate((x) => window.bm.setManualStage(x), s);
    await page.waitForTimeout(700);
    await save(`06_versionB_stage${s}`);
  }
  const dl3 = page.waitForEvent('download', { timeout: 60000 });
  await page.evaluate(() => window.bm.exportStageSheet());
  const sheetB = await dl3;
  await sheetB.saveAs(path.join(OUT, sheetB.suggestedFilename()));
  check('版本 B：导出六阶段头像', /B-head/.test(sheetB.suggestedFilename()), sheetB.suggestedFilename());
  await page.evaluate(() => window.bm.setVersion('A'));
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => ({ mode: window.bm.avatar.mode, hidden: window.bm.avatar.bodyMeshes.filter((m) => !m.visible).length }));
  check('切回版本 A：身体恢复显示', back.mode === 'corner' && back.hidden === 0);

  // 10. 桌面调参：实时预览、取消、各组共用小窗和短视频。
  await feed.evaluate((element) => { element.scrollTop = 3 * element.clientHeight; });
  await videoPlaying(4);
  await activePlayer.evaluate((player) => { player.dataset.sameFeed = 'true'; });
  const openSettings = page.getByRole('button', { name: '实验设置与实时预览' });
  await openSettings.click();
  const settings = page.getByRole('dialog', { name: '实验设置与实时预览' });
  const initialA = await page.evaluate(() => ({
    distance: window.bm.renderer.camera.position.z,
    zoom: window.bm.store.get().settings.layout.zoom,
  }));
  await settings.getByRole('slider', { name: '角色缩放' }).press('End');
  await page.waitForFunction((distance) => window.bm.renderer.camera.position.z < distance, initialA.distance);
  check('A 组：拖动参数实时改变 Avatar，草稿未保存', await page.evaluate((zoom) => {
    const canvas = window.bm.compositor.canvas;
    const frame = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return frame.some((alpha, i) => i % 4 === 3 && alpha > 0)
      && window.bm.store.get().settings.layout.zoom === zoom;
  }, initialA.zoom));
  await settings.getByRole('button', { name: '取消' }).click();
  await page.waitForFunction((distance) => window.bm.renderer.camera.position.z === distance, initialA.distance);
  check('取消调参恢复 A 组画面', await settings.count() === 0);

  await openSettings.click();
  const conditionSelect = settings.getByLabel('实验条件');
  await conditionSelect.selectOption('B');
  await settings.getByRole('button', { name: '关闭摄像头' }).click();
  await settings.getByRole('button', { name: '开启摄像头' }).click();
  await page.waitForFunction(() => window.bm.store.get().camera.status === 'on');
  if (!video) {
    await page.evaluate(() => {
      // 用确定的人脸点验证叠加流程，摄像头底图仍来自 Chrome 假设备。
      window.bm.tracker.detect = () => ({
        blendshapes: {},
        matrix: null,
        box: { cx: 0.5, cy: 0.45, w: 0.16, h: 0.26 },
        points: {
          eyeMid: [0.5, 0.42, 0], chin: [0.5, 0.56, 0], forehead: [0.5, 0.32, 0],
          cheekL: [0.55, 0.5, 0], cheekR: [0.45, 0.5, 0],
        },
      });
    });
  }
  await page.waitForFunction(() => window.bm.debugState().headPlacement?.fromFace, null, { timeout: 15000 });
  const originalHead = await page.evaluate(() => {
    const p = window.bm.debugState().headPlacement;
    return p.w / p.faceW;
  });
  await settings.getByRole('slider', { name: '贴脸大小' }).press('End');
  await page.waitForFunction((original) => {
    const p = window.bm.debugState().headPlacement;
    return p?.fromFace && p.w / p.faceW > original * 1.5;
  }, originalHead);
  const cameraWindowIsClipped = () => page.evaluate(() => {
    const { compositor, camera } = window.bm;
    const ctx = compositor.canvas.getContext('2d');
    const rect = compositor.avatarRectFor(window.bm.store.get().settings.layout);
    const top = Math.ceil(rect.y);
    const middle = Math.round(rect.x + rect.w / 2);
    const alphaAt = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
    return camera.video.currentTime > 0 && alphaAt(middle, top + 4) === 255 && alphaAt(middle, top - 4) === 0;
  });
  check('B 组：真人摄像头和实时变大的 Avatar 都裁切在右下角小窗中', await cameraWindowIsClipped());
  await settings.screenshot({ path: path.join(OUT, '07_desktop_live_preview.png') });

  await conditionSelect.selectOption('C');
  await page.waitForFunction(() => window.bm.debugState().headPlacement === null && window.bm.renderer.avatar === null);
  check('C 组：相同小窗显示摄像头，移除 Avatar', await cameraWindowIsClipped());
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  check('保存设置保留 B 组倍率与 C 组选项，计时保持停止', await page.evaluate(() => {
    const state = window.bm.store.get();
    const saved = JSON.parse(localStorage.getItem('beyond-the-mirror/settings/v1'));
    return state.settings.condition === 'C' && state.experiment.status === 'idle' && saved.headLayout.scale === 3;
  }));
  await videoPlaying(4);
  check('切换组别沿用当前短视频，不重建播放器', await activePlayer.getAttribute('data-same-feed') === 'true' && await feed.locator('.video-slide').count() === 8);

  await openSettings.click();
  await conditionSelect.selectOption('B');
  await settings.getByText('角色模型', { exact: true }).click();
  await settings.getByRole('combobox', { name: '角色模型' }).selectOption('models/samples/PS_Female.vrm');
  await page.waitForFunction(() => window.bm.renderer.avatar?.source.meta.fileName === 'PS_Female.vrm');
  check('更换角色模型会立即预览，保存前实验模型保持原样', await page.evaluate(() => window.bm.avatar.source.meta.fileName === 'avatar.vrm'));
  await settings.getByRole('button', { name: '保存并开始' }).click();
  await page.waitForFunction(() => window.bm.store.get().experiment.running);
  check('保存并开始应用模型后开启新一轮', await page.evaluate(() => window.bm.store.get().settings.modelUrl === 'models/samples/PS_Female.vrm'));
  await openSettings.click();
  const confirmEnd = page.getByRole('dialog', { name: '结束本轮实验？' });
  await confirmEnd.getByRole('button', { name: '继续实验' }).click();
  check('关闭结束确认后恢复本轮计时', await page.evaluate(() => window.bm.store.get().experiment.running));
  await openSettings.click();
  await confirmEnd.getByRole('button', { name: '结束本轮并设置' }).click();
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  check('结束本轮后可保存参数，计时保持已结束', await page.evaluate(() => window.bm.store.get().experiment.status === 'ended'));

  // 11. 关闭摄像头并用触屏入口打开同一调参界面。
  await page.evaluate(() => window.bm.stopCamera());
  await page.waitForTimeout(300);
  check('关闭摄像头', (await page.evaluate(() => window.bm.store.get().camera.status)) === 'off');

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobilePage = await mobileContext.newPage();
  mobilePage.on('pageerror', (e) => pageErrors.push(e.message));
  await mobilePage.goto(new URL('?v=B', url).href);
  const hotspot = await mobilePage.locator('.experiment-hotspot').boundingBox();
  const touch = await mobileContext.newCDPSession(mobilePage);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hotspot.x + 4, y: hotspot.y + 4 }] });
  const mobileSettings = mobilePage.getByRole('dialog', { name: '实验设置与实时预览' });
  await mobileSettings.waitFor();
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const mobilePreview = mobileSettings.locator('.preview-frame');
  const previewTop = (await mobilePreview.boundingBox()).y;
  await mobileSettings.getByText('阶段时间与过渡').click();
  const scrolled = await mobileSettings.locator('.experiment-sheet-body').evaluate((body) => {
    body.scrollTop = body.scrollHeight;
    return body.scrollTop > 0;
  });
  check('手机长按打开 B 组调参，滚动参数时实时预览留在视野中', scrolled && Math.abs((await mobilePreview.boundingBox()).y - previewTop) < 1);
  await mobileSettings.screenshot({ path: path.join(OUT, '08_mobile_live_preview.png') });
  await mobileContext.close();

  check('页面无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('自检过程未中断', false, String(err?.message ?? err));
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过。截图与录屏：${path.relative(process.cwd(), OUT) || OUT}/`);
process.exit(failed.length ? 1 : 0);
