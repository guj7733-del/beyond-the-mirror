import { describe, expect, it } from 'vitest';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { FaceProcessor } from '../src/tracking/FaceProcessor';

const matrix = (yawDeg: number, pitchDeg: number, rollDeg: number) =>
  new Matrix4()
    .compose(new Vector3(0, 0, -50), new Quaternion().setFromEuler(new Euler(pitchDeg * (Math.PI / 180), yawDeg * (Math.PI / 180), rollDeg * (Math.PI / 180), 'YXZ')), new Vector3(1, 1, 1))
    .toArray();

describe('FaceProcessor', () => {
  it('镜像模式下左右 blendshape 互换、yaw/roll 取反', () => {
    const fp = new FaceProcessor();
    fp.update({ mirror: true, smoothing: 0, linkBlink: false, blinkLow: 0, blinkHigh: 1 });
    let fr = fp.process({ blendshapes: { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.0 }, matrix: matrix(20, 10, 5), box: null }, 0);
    for (let i = 1; i < 30; i++) fr = fp.process({ blendshapes: { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.0 }, matrix: matrix(20, 10, 5), box: null }, i * 33);
    expect(fr.channels.eyeBlinkRight).toBeGreaterThan(0.8);
    expect(fr.channels.eyeBlinkLeft).toBeLessThan(0.1);
    expect(fr.head.yaw * (180 / Math.PI)).toBeCloseTo(-20, 0);
    expect(fr.head.pitch * (180 / Math.PI)).toBeCloseTo(10, 0);
    expect(fr.head.roll * (180 / Math.PI)).toBeCloseTo(-5, 0);
  });

  it('非镜像模式保持原方向', () => {
    const fp = new FaceProcessor();
    fp.update({ mirror: false, smoothing: 0 });
    let fr = fp.process({ blendshapes: {}, matrix: matrix(20, 0, 0), box: null }, 0);
    for (let i = 1; i < 30; i++) fr = fp.process({ blendshapes: {}, matrix: matrix(20, 0, 0), box: null }, i * 33);
    expect(fr.head.yaw * (180 / Math.PI)).toBeCloseTo(20, 0);
  });

  it('眨眼重映射：低于起点为 0，高于终点为 1', () => {
    const fp = new FaceProcessor();
    fp.update({ mirror: false, smoothing: 0, blinkLow: 0.2, blinkHigh: 0.6, linkBlink: false });
    let fr = fp.process({ blendshapes: { eyeBlinkLeft: 0.1, eyeBlinkRight: 0.7 }, matrix: null, box: null }, 0);
    for (let i = 1; i < 20; i++) fr = fp.process({ blendshapes: { eyeBlinkLeft: 0.1, eyeBlinkRight: 0.7 }, matrix: null, box: null }, i * 33);
    expect(fr.channels.eyeBlinkLeft).toBeCloseTo(0, 2);
    expect(fr.channels.eyeBlinkRight).toBeCloseTo(1, 2);
  });

  it('校准：把当前姿态设为正脸', () => {
    const fp = new FaceProcessor();
    fp.update({ mirror: false, smoothing: 0 });
    for (let i = 0; i < 10; i++) fp.process({ blendshapes: {}, matrix: matrix(0, 15, 0), box: null }, i * 33);
    fp.calibrate();
    fp.resetFilters();
    let fr = fp.process({ blendshapes: {}, matrix: matrix(0, 15, 0), box: null }, 400);
    for (let i = 1; i < 10; i++) fr = fp.process({ blendshapes: {}, matrix: matrix(0, 15, 0), box: null }, 400 + i * 33);
    expect(Math.abs(fr.head.pitch)).toBeLessThan(0.01);
  });

  it('闭嘴时更新下巴比例，张嘴时保持不变', () => {
    const fp = new FaceProcessor();
    fp.aspect = 1;
    const pts = (chinY: number) => ({
      eyeMid: [0.5, 0.4, 0] as [number, number, number],
      chin: [0.5, chinY, 0] as [number, number, number],
      forehead: [0.5, 0.3, 0] as [number, number, number],
      cheekL: [0.6, 0.42, 0] as [number, number, number],
      cheekR: [0.4, 0.42, 0] as [number, number, number],
    });
    for (let i = 0; i < 600; i++) fp.process({ blendshapes: { jawOpen: 0.02 }, matrix: null, box: null, points: pts(0.6) }, i * 33);
    expect(fp.restChinRatio).toBeCloseTo(1.0, 1);
    const before = fp.restChinRatio;
    for (let i = 0; i < 200; i++) fp.process({ blendshapes: { jawOpen: 0.6 }, matrix: null, box: null, points: pts(0.7) }, 20000 + i * 33);
    expect(fp.restChinRatio).toBe(before);
  });
});

