export type CameraStatus = 'off' | 'starting' | 'on' | 'error';

export interface CameraInfo {
  label: string;
  width: number;
  height: number;
  deviceId?: string;
}

/**
 * 摄像头控制：用户点击按钮后才申请权限；关闭时停止所有轨道。
 * 画面只用于本地显示和本地面捕，不上传、不保存。
 */
export class CameraController {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private session = 0;
  status: CameraStatus = 'off';
  info: CameraInfo | null = null;

  constructor() {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute('playsinline', '');
    this.video = v;
  }

  get active(): boolean {
    return this.status === 'on';
  }

  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  async start(deviceId?: string): Promise<CameraInfo> {
    if (!window.isSecureContext) {
      throw new CameraError('insecure', '摄像头只能在 localhost 或 HTTPS 页面中使用。请用 npm run dev 打开 http://localhost:5173，或用 npm run dev:lan 走 HTTPS。');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraError('unsupported', '当前浏览器不支持摄像头接口（getUserMedia），请使用新版 Chrome / Edge / Safari。');
    }
    this.stop();
    const session = this.session;
    this.status = 'starting';
    const video: MediaTrackConstraints = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
      facingMode: 'user',
    };
    if (deviceId) video.deviceId = { exact: deviceId };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: false }).catch((err: DOMException) => {
        if (err.name !== 'OverconstrainedError' || session !== this.session) throw err;
        // 分辨率要求过高时退回默认约束，保留前摄偏好。
        const fallback = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' };
        return navigator.mediaDevices.getUserMedia({ video: fallback, audio: false });
      });
    } catch (err) {
      if (session === this.session) this.status = 'error';
      throw translateError(err);
    }
    if (session !== this.session) {
      stream.getTracks().forEach((track) => track.stop());
      throw new DOMException('Camera request superseded', 'AbortError');
    }
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play().catch(() => undefined);
    await waitForVideo(this.video);
    if (session !== this.session) throw new DOMException('Camera request superseded', 'AbortError');
    const track = stream.getVideoTracks()[0];
    if (track?.readyState !== 'live') {
      this.stop();
      this.status = 'error';
      throw new CameraError('busy', '摄像头已中断，请重新开启。');
    }
    const st = track.getSettings();
    this.info = {
      label: track.label || '摄像头',
      width: this.video.videoWidth || st.width || 0,
      height: this.video.videoHeight || st.height || 0,
      deviceId: st.deviceId,
    };
    track.addEventListener('ended', () => {
      if (this.stream === stream) this.stop();
    }, { once: true });
    this.status = 'on';
    return this.info;
  }

  stop(): void {
    this.session++;
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
    }
    this.stream = null;
    this.video.srcObject = null;
    this.status = 'off';
    this.info = null;
  }

  static async listDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput');
  }
}

export class CameraError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function translateError(err: unknown): CameraError {
  const name = (err as DOMException)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('denied', '摄像头权限被拒绝。请点击地址栏左侧的摄像头图标，允许本页面使用摄像头后再试。');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('notfound', '没有找到可用的摄像头。请确认摄像头已连接，或在下拉框中换一个设备。');
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('busy', '摄像头被其他程序占用（如会议软件、其他浏览器标签页）。关闭它们后再试。');
    default:
      return new CameraError('unknown', `摄像头启动失败：${(err as Error)?.message ?? String(err)}`);
  }
}

function waitForVideo(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('loadeddata', done);
      resolve();
    };
    video.addEventListener('loadeddata', done);
    setTimeout(done, 4000);
  });
}
