import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export interface RawFace {
  /** MediaPipe 的 blendshape 名称 → 分数（0~1），不含 _neutral。 */
  blendshapes: Record<string, number>;
  /** 4×4 面部变换矩阵（列主序），可直接 Matrix4.fromArray。 */
  matrix: number[] | null;
  /** 人脸包围盒（归一化图像坐标，未镜像）。 */
  box: { cx: number; cy: number; w: number; h: number } | null;
  /** 头部叠脸版本用的关键点（归一化图像坐标，未镜像；z 与 x 同尺度）：双眼中点、下巴、额头。 */
  points?: FacePoints | null;
}

export type Vec3 = [number, number, number];
export interface FacePoints {
  eyeMid: Vec3;
  chin: Vec3;
  forehead: Vec3;
  /** 脸部轮廓左右两点（颧骨高度），用来量脸宽。 */
  cheekL: Vec3;
  cheekR: Vec3;
}

/** MediaPipe 478 点模型中的索引：33/133 右眼外内角，362/263 左眼内外角，152 下巴，10 额头，234/454 脸部左右轮廓。 */
const EYE_CORNERS = [33, 133, 362, 263];
const CHIN = 152;
const FOREHEAD = 10;
const CHEEK_R = 234;
const CHEEK_L = 454;

export type Delegate = 'GPU' | 'CPU';

/**
 * MediaPipe Face Landmarker 的薄封装。WASM 与 .task 模型都从本地 public/mediapipe 加载，
 * 运行时不访问外部网络，面部数据只在浏览器内存中处理。
 */
export class FaceTracker {
  private landmarker: FaceLandmarker | null = null;
  private lastTs = -1;
  delegate: Delegate | null = null;

  get ready(): boolean {
    return this.landmarker !== null;
  }

  async init(assetBase: string, preferGpu = true): Promise<Delegate> {
    const base = new URL(assetBase, document.baseURI).href.replace(/\/$/, '');
    const fileset = await FilesetResolver.forVisionTasks(`${base}/wasm`);
    const make = (delegate: Delegate) =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}/face_landmarker.task`, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    if (preferGpu) {
      try {
        this.landmarker = await make('GPU');
        this.delegate = 'GPU';
        return 'GPU';
      } catch (err) {
        console.warn('[FaceTracker] GPU delegate 初始化失败，改用 CPU：', err);
      }
    }
    this.landmarker = await make('CPU');
    this.delegate = 'CPU';
    return 'CPU';
  }

  detect(video: HTMLVideoElement, nowMs: number): RawFace | null {
    if (!this.landmarker) return null;
    // detectForVideo 要求时间戳严格递增
    const ts = nowMs <= this.lastTs ? this.lastTs + 1 : nowMs;
    this.lastTs = ts;
    const result = this.landmarker.detectForVideo(video, ts);
    const shapes = result.faceBlendshapes?.[0]?.categories;
    if (!shapes || shapes.length === 0) return null;
    const blendshapes: Record<string, number> = {};
    for (const c of shapes) {
      if (c.categoryName && c.categoryName !== '_neutral') blendshapes[c.categoryName] = c.score;
    }
    const matrix = result.facialTransformationMatrixes?.[0]?.data ?? null;
    let box: RawFace['box'] = null;
    let points: FacePoints | null = null;
    const lm = result.faceLandmarks?.[0];
    if (lm && lm.length > CHEEK_L) {
      const eye: Vec3 = [0, 0, 0];
      for (const i of EYE_CORNERS) {
        eye[0] += lm[i].x / EYE_CORNERS.length;
        eye[1] += lm[i].y / EYE_CORNERS.length;
        eye[2] += (lm[i].z ?? 0) / EYE_CORNERS.length;
      }
      const at = (i: number): Vec3 => [lm[i].x, lm[i].y, lm[i].z ?? 0];
      points = { eyeMid: eye, chin: at(CHIN), forehead: at(FOREHEAD), cheekL: at(CHEEK_L), cheekR: at(CHEEK_R) };
    }
    if (lm && lm.length > 0) {
      let minX = 1, minY = 1, maxX = 0, maxY = 0;
      for (const p of lm) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      box = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
    }
    return { blendshapes, matrix: matrix ? Array.from(matrix) : null, box, points };
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.delegate = null;
    this.lastTs = -1;
  }
}
