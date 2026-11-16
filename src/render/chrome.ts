/**
 * 简化的短视频界面（仅作情境模拟，不可交互，不接入任何平台）。
 * 坐标以 1080×1920 为基准，绘制时按画布实际尺寸缩放。
 */

const ICONS = {
  heart: 'M12 21.2s-7.6-4.6-10-9.4C.4 8.6 2.2 4.4 6.1 4.4c2.3 0 3.7 1.3 5.9 3.6 2.2-2.3 3.6-3.6 5.9-3.6 3.9 0 5.7 4.2 4.1 7.4-2.4 4.8-10 9.4-10 9.4z',
  comment: 'M12 3.2c-5.6 0-10 3.8-10 8.5 0 2.6 1.4 5 3.7 6.5l-.9 3.4 4.2-2.1c1 .2 2 .3 3 .3 5.6 0 10-3.8 10-8.6S17.6 3.2 12 3.2z',
  share: 'M13.6 4.2l8.2 7.4-8.2 7.4v-4.5c-5.6-.1-9.2 1.6-11.8 5.4.9-5.6 4.3-10.2 11.8-11.2V4.2z',
  home: 'M3.2 11.2L12 3.8l8.8 7.4V20c0 .6-.4 1-1 1h-4.9v-6.1H9.1V21H4.2c-.6 0-1-.4-1-1z',
};

function icon(ctx: CanvasRenderingContext2D, path: string, x: number, y: number, size: number, fill = '#fff') {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = fill;
  ctx.fill(new Path2D(path));
  ctx.restore();
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, weight = 600, color = '#fff', align: CanvasTextAlign = 'center') {
  ctx.font = `${weight} ${size}px -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

export function drawChrome(ctx: CanvasRenderingContext2D, W: number, H: number, clock: string): void {
  ctx.save();
  ctx.scale(W / 1080, H / 1920);
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 8;

  // 顶部渐变，保证白字可读
  ctx.save();
  ctx.shadowColor = 'transparent';
  const topGrad = ctx.createLinearGradient(0, 0, 0, 330);
  topGrad.addColorStop(0, 'rgba(0,0,0,0.32)');
  topGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, 1080, 330);
  ctx.restore();

  // 状态栏
  text(ctx, clock, 72, 66, 44, 600, '#fff', 'left');
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 4; i++) ctx.fillRect(792 + i * 16, 76 - (i + 1) * 9, 10, (i + 1) * 9);
  text(ctx, '5G', 878, 66, 36, 600);
  ctx.save();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(920, 48, 80, 38, 10);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(925, 53, 62, 28, 6);
  ctx.fill();
  ctx.fillRect(1003, 60, 5, 14);
  ctx.restore();

  // 顶部导航
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 3; i++) ctx.fillRect(48, 168 + i * 16, 48, 6);
  text(ctx, '推荐', 448, 186, 56, 700);
  text(ctx, '关注', 640, 186, 52, 500, 'rgba(255,255,255,0.72)');
  ctx.fillRect(424, 226, 48, 7);
  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(1004, 180, 24, 0, Math.PI * 2);
  ctx.moveTo(1022, 198);
  ctx.lineTo(1044, 220);
  ctx.stroke();
  ctx.restore();

  // 右侧互动图标
  const rx = 992;
  icon(ctx, ICONS.heart, rx, 530, 92);
  text(ctx, '5.5万', rx, 600, 34, 600);
  icon(ctx, ICONS.comment, rx, 700, 88);
  ctx.save();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(40,40,40,0.9)';
  for (const dx of [-16, 0, 16]) {
    ctx.beginPath();
    ctx.arc(rx + dx, 697, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  text(ctx, '194', rx, 770, 34, 600);
  icon(ctx, ICONS.share, rx, 868, 86);
  text(ctx, '6223', rx, 936, 34, 600);

  // 底部导航
  ctx.save();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(10,10,12,0.96)';
  ctx.fillRect(0, 1745, 1080, 175);
  ctx.restore();
  ctx.shadowBlur = 0;
  const y = 1818;
  icon(ctx, ICONS.home, 110, y, 64);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  // 朋友
  ctx.beginPath();
  ctx.arc(318, y - 12, 14, 0, Math.PI * 2);
  ctx.moveTo(292, y + 26);
  ctx.quadraticCurveTo(318, y - 2, 344, y + 26);
  ctx.moveTo(350, y - 22);
  ctx.arc(342, y - 12, 12, -Math.PI / 2.4, Math.PI / 2.4);
  ctx.moveTo(352, y + 6);
  ctx.quadraticCurveTo(366, y + 12, 368, y + 26);
  ctx.stroke();
  // 加号
  ctx.beginPath();
  ctx.roundRect(506, y - 32, 68, 62, 14);
  ctx.moveTo(540, y - 15);
  ctx.lineTo(540, y + 13);
  ctx.moveTo(526, y - 1);
  ctx.lineTo(554, y - 1);
  ctx.stroke();
  // 消息
  ctx.beginPath();
  ctx.ellipse(760, y - 4, 32, 27, 0, Math.PI * 0.62, Math.PI * 2.38);
  ctx.lineTo(742, y + 30);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = '#fff';
  for (const dx of [-13, 0, 13]) {
    ctx.beginPath();
    ctx.arc(760 + dx, y - 4, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // 我
  ctx.beginPath();
  ctx.arc(975, y - 12, 15, 0, Math.PI * 2);
  ctx.moveTo(946, y + 28);
  ctx.quadraticCurveTo(975, y - 4, 1004, y + 28);
  ctx.stroke();
  ctx.restore();
}

/** 底部导航栏上沿占画面高度的比例（Avatar 默认贴着这里）。 */
export const NAV_TOP_RATIO = 1745 / 1920;
