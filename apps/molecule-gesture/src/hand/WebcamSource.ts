/** Webcam acquisition via getUserMedia. Knows nothing about models. */
export class WebcamSource {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;

  constructor(video?: HTMLVideoElement) {
    this.video = video ?? document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
  }

  get active(): boolean {
    return this.stream !== null;
  }

  get width(): number {
    return this.video.videoWidth;
  }

  get height(): number {
    return this.video.videoHeight;
  }

  async start(constraints: MediaTrackConstraints = {}): Promise<void> {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not support webcam access (getUserMedia). Use Chrome or Edge over http://localhost or HTTPS.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user', ...constraints },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    if (!this.video.videoWidth) {
      await new Promise<void>((resolve) => this.video.addEventListener('loadedmetadata', () => resolve(), { once: true }));
    }
  }

  /** Snapshot the current frame as a transferable ImageBitmap. */
  grab(): Promise<ImageBitmap> {
    return createImageBitmap(this.video);
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
