type SafariVideo = HTMLVideoElement & {
  webkitPresentationMode?: string;
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
};

export type PictureInPictureStatus = 'unavailable' | 'idle' | 'preparing' | 'ready' | 'opening' | 'active';

export class PictureInPicture {
  readonly video: SafariVideo = document.createElement('video');
  readonly supported = document.pictureInPictureEnabled === true || typeof this.video.webkitSetPresentationMode === 'function';
  private source: MediaStream | null = null;
  private output: MediaStream | null = null;
  private openingTimer = 0;
  status: PictureInPictureStatus = this.supported ? 'idle' : 'unavailable';

  constructor(
    private readonly onStatus: (status: PictureInPictureStatus) => void,
    private readonly onError: (message: string) => void,
  ) {
    const video = this.video;
    video.className = 'pip-video';
    video.setAttribute('aria-hidden', 'true');
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.addEventListener('loadeddata', this.syncStatus);
    video.addEventListener('playing', this.syncStatus);
    video.addEventListener('enterpictureinpicture', this.syncStatus);
    video.addEventListener('leavepictureinpicture', this.syncStatus);
    video.addEventListener('webkitpresentationmodechanged', this.syncStatus);
  }

  get compositing(): boolean {
    return this.output !== null;
  }

  prepare(camera: MediaStream, canvas?: HTMLCanvasElement): void {
    if (!this.supported || (camera === this.source && !!canvas === this.compositing)) return;
    this.clear();
    try {
      // A uses the camera track directly, so video playback doesn't depend on page rendering.
      // The compositor already limits updates. Capture each draw without a second frame timer.
      this.output = canvas ? canvas.captureStream() : null;
      this.source = camera;
      const media = this.output ?? camera;
      this.video.srcObject = media;
      this.setStatus('preparing');
      void this.video.play().catch(() => {
        // Safari can require another tap to start inline playback.
        if (this.video.srcObject === media && this.status === 'preparing') this.setStatus('ready');
      });
    } catch {
      this.clear();
      this.onError('当前浏览器无法输出 Avatar 画面，试试用 Safari 打开网页。');
    }
  }

  async toggle(): Promise<void> {
    if (this.status === 'active') {
      this.exit();
      return;
    }
    if ((this.status !== 'ready' && this.status !== 'preparing') || !this.source) return;
    const source = this.video.srcObject;
    const video = this.video;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      void video.play().catch(() => {
        if (video.srcObject === source) this.onError('画中画视频暂时无法播放，请重新开启摄像头。');
      });
      this.onError('视频还在准备，请稍后再点一次。');
      return;
    }
    this.setStatus('opening');
    this.openingTimer = window.setTimeout(() => {
      this.syncStatus();
      if (this.status === 'active' || this.video.srcObject !== source) return;
      this.setStatus('ready');
      this.onError('Safari 没有打开画中画。请直接在 Safari 中打开网页，再点一次。');
    }, 3000);
    try {
      void video.play().catch(() => undefined);
      if (video.webkitSupportsPresentationMode?.('picture-in-picture') && video.webkitSetPresentationMode) {
        video.webkitSetPresentationMode('picture-in-picture');
      } else if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
        await video.requestPictureInPicture();
      } else {
        throw new Error('当前视频不支持画中画');
      }
      if (this.video.srcObject === source) this.syncStatus();
    } catch {
      if (this.video.srcObject !== source || this.isOpen()) return;
      window.clearTimeout(this.openingTimer);
      this.setStatus('ready');
      this.onError('当前环境无法打开画中画。请直接使用 iPhone Safari，或用 A 组前摄确认画中画是否可用。');
    }
  }

  clear(): void {
    window.clearTimeout(this.openingTimer);
    this.exit();
    this.source = null;
    this.output?.getTracks().forEach((track) => track.stop());
    this.output = null;
    this.video.pause();
    this.video.srcObject = null;
    this.setStatus(this.supported ? 'idle' : 'unavailable');
  }

  private isOpen(): boolean {
    return document.pictureInPictureElement === this.video || this.video.webkitPresentationMode === 'picture-in-picture';
  }

  private exit(): void {
    if (this.video.webkitPresentationMode === 'picture-in-picture') {
      this.video.webkitSetPresentationMode?.('inline');
    } else if (document.pictureInPictureElement === this.video) {
      void document.exitPictureInPicture().catch(() => undefined);
    }
  }

  private syncStatus = (): void => {
    if (!this.source) return;
    if (this.isOpen()) {
      window.clearTimeout(this.openingTimer);
      this.setStatus('active');
    } else if (this.status !== 'opening' && this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.setStatus('ready');
    }
  };

  private setStatus(status: PictureInPictureStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.onStatus(status);
  }
}
