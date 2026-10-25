import type { VisionAlert, VisionController } from './types.js';

interface RecordingVisionDependencies {
  getStream: () => Promise<MediaStream>;
  initialize: (onAlert: (event: VisionAlert) => void, onError: (error: unknown) => void) => Promise<VisionController>;
  onAlert: (event: VisionAlert) => void;
  onError: (error: unknown) => void;
}

/** One owner per recording. Late permission/model results are always released. */
export class RecordingVision {
  private stream: MediaStream | null = null;
  private controller: VisionController | null = null;
  private pending: Promise<void> | null = null;
  private disposed = false;
  private recording = true;
  private video: HTMLVideoElement;
  private deps: RecordingVisionDependencies;

  constructor(video: HTMLVideoElement, deps: RecordingVisionDependencies) {
    this.video = video;
    this.deps = deps;
  }

  setRecording(recording: boolean): void {
    if (this.disposed || recording === this.recording) return;
    this.recording = recording;
    if (recording) this.controller?.start(this.video);
    else this.controller?.stop();
  }

  start(): Promise<void> {
    if (!this.pending && !this.disposed) this.pending = this.initialize();
    return this.pending ?? Promise.resolve();
  }

  stop(): void {
    if (this.disposed) return;
    this.disposed = true;
    try { this.controller?.cleanup(); }
    catch { /* Camera release must survive model cleanup errors. */ }
    this.controller = null;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
  }

  private async initialize(): Promise<void> {
    try {
      const stream = await this.deps.getStream();
      if (this.disposed) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.stream = stream;
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => this.fail(new Error('Camera disconnected')), { once: true });
      }
      this.video.srcObject = stream;
      await this.video.play();
      if (this.disposed) return;
      const controller = await this.deps.initialize(
        event => { if (!this.disposed && this.recording) this.deps.onAlert(event); },
        error => this.fail(error),
      );
      if (this.disposed) { controller.cleanup(); return; }
      this.controller = controller;
      if (this.recording) controller.start(this.video);
    } catch (error) { this.fail(error); }
  }

  private fail(error: unknown): void {
    if (this.disposed) return;
    this.stop();
    this.deps.onError(error);
  }
}
