import { FaceLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { finiteLandmark, visiblePoseLandmark } from '../measurements.js';
import type { Landmark, LandmarkFrame } from '../types.js';

/** Match the video's object-fit: contain rectangle, including letterbox offsets. */
export function containRect(width: number, height: number, videoWidth: number, videoHeight: number) {
  const scale = Math.min(width / videoWidth, height / videoHeight);
  const w = videoWidth * scale, h = videoHeight * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

const inFrame = (point: Landmark | undefined): point is Landmark =>
  finiteLandmark(point) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;

/** Draw normalized raw detections; CSS mirrors the video AND canvas exactly once. */
export function drawLandmarks(
  ctx: CanvasRenderingContext2D, frame: LandmarkFrame, width: number, height: number,
): void {
  ctx.clearRect(0, 0, width, height);
  if (width <= 0 || height <= 0 || frame.width <= 0 || frame.height <= 0) return;
  const rect = containRect(width, height, frame.width, frame.height);
  const x = (point: Landmark) => rect.x + point.x * rect.width;
  const y = (point: Landmark) => rect.y + point.y * rect.height;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  function lines(points: readonly Landmark[], edges: readonly { start: number; end: number }[],
    color: string, isPose: boolean) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (const edge of edges) {
      const start = points[edge.start], end = points[edge.end];
      if (!inFrame(start) || !inFrame(end)) continue;
      if (isPose && (!visiblePoseLandmark(start) || !visiblePoseLandmark(end))) continue;
      ctx.moveTo(x(start), y(start));
      ctx.lineTo(x(end), y(end));
    }
    ctx.stroke();
  }

  lines(frame.pose, PoseLandmarker.POSE_CONNECTIONS, '#7ce2bc', true);
  lines(frame.face, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, '#9bcfff', false);
  for (const point of frame.pose) {
    if (!inFrame(point)) continue;
    ctx.fillStyle = visiblePoseLandmark(point) ? '#f8fff9' : '#ffd183';
    ctx.beginPath();
    ctx.arc(x(point), y(point), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Only orientation anchors are dotted to keep the face outline legible.
  ctx.fillStyle = '#9bcfff';
  for (const index of [1, 33, 263]) {
    const point = frame.face[index];
    if (!inFrame(point)) continue;
    ctx.beginPath();
    ctx.arc(x(point), y(point), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

export class LandmarkOverlay {
  private readonly context: CanvasRenderingContext2D;
  private readonly observer: ResizeObserver;
  private latest: LandmarkFrame | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The landmark overlay requires a browser with Canvas 2D support.');
    this.context = context;
    this.observer = new ResizeObserver(() => this.render());
    this.observer.observe(canvas);
  }

  update(frame: LandmarkFrame): void {
    this.latest = frame;
    this.render();
  }

  private render(): void {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.latest) drawLandmarks(this.context, this.latest, width, height);
    else this.context.clearRect(0, 0, width, height);
  }

  clear(): void { this.latest = null; this.render(); }
  cleanup(): void { this.observer.disconnect(); this.clear(); }
}
