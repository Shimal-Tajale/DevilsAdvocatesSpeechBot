import type { VisionController, VisionOptions } from '../types.js';

export type CameraState = 'stopped' | 'requesting' | 'loading' | 'running';

interface Dependencies {
  getStream: () => Promise<MediaStream>;
  checkAssets: (signal: AbortSignal) => Promise<void>;
  initialize: (options: VisionOptions) => Promise<VisionController>;
  onState: (state: CameraState) => void;
  onError: (error: unknown) => void;
}

/** Camera ownership only; all vision analysis remains in the existing module. */
export class WebcamSession {
  private generation = 0;
  private stream: MediaStream | null = null;
  private controller: VisionController | null = null;
  private abort: AbortController | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly options: VisionOptions,
    private readonly deps: Dependencies,
  ) {}

  stop(): void {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    // Release camera tracks even if MediaPipe cleanup fails.
    try { this.controller?.cleanup(); }
    finally {
      this.controller = null;
      this.stream?.getTracks().forEach(track => track.stop());
      this.stream = null;
      this.video.pause();
      this.video.srcObject = null;
      this.deps.onState('stopped');
    }
  }

  recalibrate(): void { this.controller?.recalibrate(); }

  async start(): Promise<void> {
    this.stop();
    const generation = this.generation;
    const current = () => generation === this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.deps.onState('requesting');
    try {
      const stream = await this.deps.getStream();
      if (!current()) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.stream = stream;
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (current()) {
            this.stop();
            this.deps.onError(new Error('The camera disconnected or access was revoked. Start Camera to retry.'));
          }
        }, { once: true });
      }
      this.video.srcObject = stream;
      await this.video.play();
      if (!current()) return;
      this.deps.onState('loading');
      await this.deps.checkAssets(abort.signal);
      if (!current()) return;
      const instance = await this.deps.initialize({
        ...this.options,
        onAlert: event => { if (current()) this.options.onAlert(event); },
        onStatus: status => { if (current()) this.options.onStatus?.(status); },
        onLandmarks: frame => { if (current()) this.options.onLandmarks?.(frame); },
        onError: error => {
          if (current()) {
            this.stop();
            this.deps.onError(error);
          }
        },
      });
      if (!current()) {
        instance.cleanup();
        return;
      }
      this.controller = instance;
      instance.start(this.video);
      this.deps.onState('running');
    } catch (error) {
      if (current()) {
        this.stop();
        this.deps.onError(error);
      }
    }
  }
}
