import { CanvasTexture, SRGBColorSpace, RepeatWrapping, Texture, TextureLoader } from 'three';

/**
 * 疲惫效果用到的透明图层。默认用 Canvas 程序化绘制；研究者也可以在
 * src/config/overlayTextures.ts 里指定自己的透明 PNG（如额头黑线、乌云、眩晕符号）。
 */
export type OverlayTextureKey =
  | 'darkCircle'
  | 'eyeBag'
  | 'spiralEye'
  | 'xEye'
  | 'foreheadLines'
  | 'sparkle'
  | 'sigh'
  | 'swirl'
  | 'cloud'
  | 'rain';

export type OverlayTextures = Record<OverlayTextureKey, Texture>;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** 眼下阴影：上沿贴着下眼睑，向下逐渐变淡的月牙形。 */
function darkCircle(): CanvasTexture {
  const [c, g] = makeCanvas(256, 160);
  g.save();
  g.translate(128, 52);
  g.scale(1, 0.62);
  const grd = g.createRadialGradient(0, 0, 8, 0, 0, 122);
  grd.addColorStop(0, 'rgba(58,30,78,0.95)');
  grd.addColorStop(0.45, 'rgba(68,36,86,0.7)');
  grd.addColorStop(1, 'rgba(70,40,90,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(0, 0, 122, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // 挖掉上半部分，留出眼睛
  g.globalCompositeOperation = 'destination-out';
  g.save();
  g.translate(128, 8);
  g.scale(1, 0.42);
  const cut = g.createRadialGradient(0, 0, 50, 0, 0, 128);
  cut.addColorStop(0, 'rgba(0,0,0,1)');
  cut.addColorStop(0.7, 'rgba(0,0,0,0.85)');
  cut.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = cut;
  g.beginPath();
  g.arc(0, 0, 128, 0, Math.PI * 2);
  g.fill();
  g.restore();
  return toTexture(c);
}

/** 眼袋：两道下弯的弧线加一层浅阴影。 */
function eyeBag(): CanvasTexture {
  const [c, g] = makeCanvas(256, 128);
  g.lineCap = 'round';
  const arc = (y: number, w: number, alpha: number, lw: number) => {
    g.strokeStyle = `rgba(60,30,70,${alpha})`;
    g.lineWidth = lw;
    g.beginPath();
    g.moveTo(128 - w, y);
    g.quadraticCurveTo(128, y + 34, 128 + w, y);
    g.stroke();
  };
  g.save();
  g.translate(128, 52);
  g.scale(1, 0.4);
  const fill = g.createRadialGradient(0, 0, 4, 0, 0, 96);
  fill.addColorStop(0, 'rgba(70,40,85,0.45)');
  fill.addColorStop(1, 'rgba(70,40,85,0)');
  g.fillStyle = fill;
  g.beginPath();
  g.arc(0, 0, 96, 0, Math.PI * 2);
  g.fill();
  g.restore();
  arc(40, 84, 0.75, 7);
  arc(62, 60, 0.45, 5);
  return toTexture(c);
}

/** 螺旋眼：白底椭圆 + 黑色螺旋。 */
function spiralEye(): CanvasTexture {
  const [c, g] = makeCanvas(256, 256);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#2b2b2b';
  g.lineWidth = 8;
  g.beginPath();
  g.ellipse(128, 128, 116, 116, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.lineWidth = 10;
  g.lineCap = 'round';
  g.beginPath();
  const turns = 3.2;
  for (let t = 0; t <= Math.PI * 2 * turns; t += 0.04) {
    const r = 6 + (t / (Math.PI * 2 * turns)) * 98;
    const x = 128 + Math.cos(t) * r;
    const y = 128 + Math.sin(t) * r;
    if (t === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  return toTexture(c);
}

/** 漫画式 × 眼。 */
function xEye(): CanvasTexture {
  const [c, g] = makeCanvas(256, 256);
  g.lineCap = 'round';
  g.strokeStyle = '#262626';
  g.lineWidth = 30;
  g.beginPath();
  g.moveTo(52, 52);
  g.lineTo(204, 204);
  g.moveTo(204, 52);
  g.lineTo(52, 204);
  g.stroke();
  return toTexture(c);
}

/** 额头压力线（漫画里的“阴影竖线”）：淡蓝紫阴影 + 一排长短不一的细竖线，四周渐隐，没有硬边。 */
function foreheadLines(): CanvasTexture {
  const [c, g] = makeCanvas(256, 256);
  g.save();
  g.translate(128, 120);
  g.scale(1, 0.85);
  const shade = g.createRadialGradient(0, 0, 10, 0, 0, 122);
  shade.addColorStop(0, 'rgba(72,62,150,0.34)');
  shade.addColorStop(0.6, 'rgba(72,62,150,0.18)');
  shade.addColorStop(1, 'rgba(72,62,150,0)');
  g.fillStyle = shade;
  g.beginPath();
  g.arc(0, 0, 122, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.lineCap = 'round';
  const xs = [44, 62, 80, 98, 116, 134, 152, 170, 188, 208];
  const lens = [92, 128, 110, 150, 124, 158, 132, 146, 114, 90];
  const tops = [62, 44, 52, 36, 46, 34, 42, 40, 50, 64];
  xs.forEach((x, i) => {
    const y0 = tops[i];
    const grd = g.createLinearGradient(0, y0, 0, y0 + lens[i]);
    grd.addColorStop(0, 'rgba(76,60,158,0)');
    grd.addColorStop(0.18, 'rgba(76,60,158,0.85)');
    grd.addColorStop(0.7, 'rgba(76,60,158,0.55)');
    grd.addColorStop(1, 'rgba(76,60,158,0)');
    g.strokeStyle = grd;
    g.lineWidth = i % 2 ? 3.5 : 4.5;
    g.beginPath();
    g.moveTo(x, y0);
    g.lineTo(x, y0 + lens[i]);
    g.stroke();
  });
  return toTexture(c);
}

/** 精神饱满的放射短线（参考图 Stage 0 头部旁的黄色线条）。 */
function sparkle(): CanvasTexture {
  const [c, g] = makeCanvas(256, 256);
  g.lineCap = 'round';
  const rays = [
    [-0.55, 70, 128],
    [0, 74, 132],
    [0.55, 70, 128],
  ];
  for (const [a, r0, r1] of rays) {
    const x0 = 128 + Math.sin(a) * r0 * 0.4;
    const y0 = 200 - Math.cos(a) * r0 * 0.4;
    const x1 = 128 + Math.sin(a) * r1;
    const y1 = 200 - Math.cos(a) * r1;
    g.strokeStyle = '#3b2a00';
    g.lineWidth = 26;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.strokeStyle = '#ffd43b';
    g.lineWidth = 17;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }
  return toTexture(c);
}

/** 叹气的小白云。 */
function sigh(): CanvasTexture {
  const [c, g] = makeCanvas(256, 192);
  const puffs: [number, number, number][] = [
    [80, 112, 46],
    [128, 92, 54],
    [176, 112, 44],
    [128, 132, 46],
  ];
  g.fillStyle = '#9a9a9a';
  for (const [x, y, r] of puffs) {
    g.beginPath();
    g.arc(x, y, r + 6, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#f4f4f4';
  for (const [x, y, r] of puffs) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return toTexture(c);
}

/** 头顶眩晕旋涡（圆形，渲染时把平面放倒并旋转）。 */
function swirl(): CanvasTexture {
  const [c, g] = makeCanvas(256, 256);
  g.lineCap = 'round';
  const draw = (color: string, lw: number) => {
    g.strokeStyle = color;
    g.lineWidth = lw;
    g.beginPath();
    const turns = 2.6;
    for (let t = 0; t <= Math.PI * 2 * turns; t += 0.04) {
      const r = 8 + (t / (Math.PI * 2 * turns)) * 104;
      const x = 128 + Math.cos(t) * r;
      const y = 128 + Math.sin(t) * r;
      if (t === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  };
  draw('rgba(255,255,255,0.9)', 22);
  draw('#3a3a3a', 12);
  return toTexture(c);
}

/** 乌云。 */
function cloud(): CanvasTexture {
  const [c, g] = makeCanvas(256, 160);
  const puffs: [number, number, number][] = [
    [62, 100, 40],
    [104, 76, 50],
    [156, 70, 54],
    [200, 98, 40],
    [130, 108, 46],
  ];
  g.fillStyle = '#2f3338';
  for (const [x, y, r] of puffs) {
    g.beginPath();
    g.arc(x, y, r + 5, 0, Math.PI * 2);
    g.fill();
  }
  const grd = g.createLinearGradient(0, 20, 0, 150);
  grd.addColorStop(0, '#6c727a');
  grd.addColorStop(1, '#4a4f56');
  g.fillStyle = grd;
  for (const [x, y, r] of puffs) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return toTexture(c);
}

/** 雨丝（可纵向平铺滚动）。 */
function rain(): CanvasTexture {
  const [c, g] = makeCanvas(128, 256);
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(60,72,92,0.95)';
  g.lineWidth = 7;
  const drops = [
    [20, 10], [52, 60], [86, 30], [112, 90], [34, 140], [70, 170], [100, 210], [16, 220],
  ];
  for (const [x, y] of drops) {
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - 4, y + 34);
    g.stroke();
  }
  const t = toTexture(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  return t;
}

const FACTORIES: Record<OverlayTextureKey, () => Texture> = {
  darkCircle, eyeBag, spiralEye, xEye, foreheadLines, sparkle, sigh, swirl, cloud, rain,
};

export async function createOverlayTextures(overrides: Partial<Record<OverlayTextureKey, string>> = {}): Promise<OverlayTextures> {
  const out = {} as OverlayTextures;
  const loader = new TextureLoader();
  for (const key of Object.keys(FACTORIES) as OverlayTextureKey[]) {
    const url = overrides[key];
    if (url) {
      try {
        const tex = await loader.loadAsync(url);
        tex.colorSpace = SRGBColorSpace;
        if (key === 'rain') {
          tex.wrapS = RepeatWrapping;
          tex.wrapT = RepeatWrapping;
        }
        out[key] = tex;
        continue;
      } catch (err) {
        console.warn(`[overlay] 贴图 ${url} 加载失败，改用程序化默认图案`, err);
      }
    }
    out[key] = FACTORIES[key]();
  }
  return out;
}
