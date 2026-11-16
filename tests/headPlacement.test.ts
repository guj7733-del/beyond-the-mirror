import { describe, expect, it } from 'vitest';
import { computeHeadPlacement, mapToCanvas, type PlacementInput } from '../src/render/headPlacement';
import type { FacePoints } from '../src/tracking/FaceTracker';

const W = 1080;
const H = 1920;
// 视频 1080×1920，裁切框就是整幅画面，1 个视频像素 = 1 个画布像素
const crop = { sx: 0, sy: 0, sw: 1080, sh: 1920, vw: 1080, vh: 1920 };
const face = (chinY: number): FacePoints => ({
  eyeMid: [0.5, 0.4, 0],
  chin: [0.5, chinY, 0],
  forehead: [0.5, 0.3, 0],
  cheekL: [0.6, 0.42, 0],
  cheekR: [0.4, 0.42, 0],
});
const base: PlacementInput = {
  W, H, crop, mirror: false, face: null, restChinRatio: 0.85,
  canvasW: 1024, canvasH: 1024, chinPx: { x: 512, y: 700 }, widthPx: 200, scale: 1, offsetX: 0, offsetY: 0,
};

describe('版本 B 头部摆放', () => {
  it('没有人脸时放在画面中央偏上', () => {
    const p = computeHeadPlacement(base);
    expect(p.fromFace).toBe(false);
    expect(p.faceW).toBeCloseTo(W * 0.42);
    expect(p.chin.x).toBeCloseTo(W / 2);
    expect(p.scale).toBeCloseTo((W * 0.42) / 200);
  });

  it('按脸宽缩放，角色下巴落在用户闭嘴时的下巴上', () => {
    const p = computeHeadPlacement({ ...base, face: face(0.6) });
    expect(p.fromFace).toBe(true);
    expect(p.faceW).toBeCloseTo(0.2 * 1080);
    expect(p.scale).toBeCloseTo((0.2 * 1080) / 200);
    // 角色下巴（头部画布中的 chinPx）经过缩放平移后正好落在推算出的下巴位置
    expect(p.x + 512 * p.scale).toBeCloseTo(p.chin.x);
    expect(p.y + 700 * p.scale).toBeCloseTo(p.chin.y);
    expect(p.chin.y - p.eye.y).toBeCloseTo(0.85 * p.faceW);
  });

  it('张嘴（下巴关键点下移）时头部位置不变', () => {
    const closed = computeHeadPlacement({ ...base, face: face(0.6) });
    const open = computeHeadPlacement({ ...base, face: face(0.66) });
    expect(open.x).toBeCloseTo(closed.x);
    expect(open.y).toBeCloseTo(closed.y);
    expect(open.scale).toBeCloseTo(closed.scale);
  });

  it('镜像时左右翻转', () => {
    expect(mapToCanvas([0.3, 0.5, 0], crop, W, H, true).x).toBeCloseTo(W * 0.7);
    expect(mapToCanvas([0.3, 0.5, 0], crop, W, H, false).x).toBeCloseTo(W * 0.3);
  });

  it('大小倍数与偏移', () => {
    const p1 = computeHeadPlacement({ ...base, face: face(0.6) });
    const p2 = computeHeadPlacement({ ...base, face: face(0.6), scale: 1.2, offsetY: 0.1 });
    expect(p2.scale).toBeCloseTo(p1.scale * 1.2);
    expect(p2.y + 700 * p2.scale).toBeCloseTo(p1.chin.y + 0.1 * p1.faceW);
  });
});
