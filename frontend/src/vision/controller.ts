import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { VisionAnalysis } from './analysis.js';
import { measure } from './measurements.js';
import type { VisionController, VisionOptions } from './types.js';

/** Load both models once. The caller owns camera permissions, playback and tracks. */
export async function initializeVision(options: VisionOptions): Promise<VisionController> {
  const maxFps = options.maxFps ?? 15;
  if (!Number.isFinite(maxFps) || maxFps <= 0) throw new Error('maxFps must be positive');
  const analysis = new VisionAnalysis(options.onAlert, options.analysis);
  const files = await FilesetResolver.forVisionTasks(options.wasmRoot);
  const pose = await PoseLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: options.poseModelPath, delegate: options.delegate ?? 'CPU' },
    runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: false,
  });
  let face: FaceLandmarker;
  try {
    face = await FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: options.faceModelPath, delegate: options.delegate ?? 'CPU' },
      runningMode: 'VIDEO', numFaces: 1,
      outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false,
    });
  } catch (error) {
    pose.close();
    throw error;
  }

  let video: HTMLVideoElement | null = null;
  let running = false;
  let disposed = false;
  let frame: number | null = null;
  let lastWallTime = -Infinity;
  let lastVideoTime = -1;
  let lastInferenceTime = -1;

  function recalibrate(): void {
    analysis.reset();
    lastVideoTime = -1;
    lastWallTime = -Infinity;
  }
  function interrupt(): void { analysis.interrupt(); }
  function stop(): void {
    running = false;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (video) {
      video.removeEventListener('seeking', recalibrate);
      video.removeEventListener('emptied', recalibrate);
      video.removeEventListener('loadedmetadata', recalibrate);
      video.removeEventListener('pause', interrupt);
      video.removeEventListener('ended', stop);
    }
    video = null;
    analysis.interrupt();
  }

  function tick(wallTime: number): void {
    frame = null;
    if (!running || !video) return;
    const input = video;
    try {
      if (!input.paused && !input.ended && !input.seeking && input.readyState >= 2 &&
          input.videoWidth > 0 && input.videoHeight > 0 &&
          input.currentTime !== lastVideoTime && wallTime - lastWallTime >= 1000 / maxFps) {
        if (input.currentTime < lastVideoTime) recalibrate();
        const frameGapMs = lastVideoTime < 0 ? null : (input.currentTime - lastVideoTime) * 1000;
        lastVideoTime = input.currentTime;
        lastWallTime = wallTime;
        // MediaPipe requires increasing timestamps, even after a replay seek.
        const inferenceStart = performance.now();
        const inferenceTime = Math.max(inferenceStart, lastInferenceTime + 0.001);
        lastInferenceTime = inferenceTime;
        const poseResult = pose.detectForVideo(input, inferenceTime);
        const faceResult = face.detectForVideo(input, inferenceTime);
        const inferenceMs = performance.now() - inferenceStart;
        options.onLandmarks?.({
          pose: poseResult.landmarks[0] ?? [], face: faceResult.faceLandmarks[0] ?? [],
          width: input.videoWidth, height: input.videoHeight,
          videoTimeMs: input.currentTime * 1000, inferenceMs, frameGapMs,
        });
        const status = analysis.update(measure(
          poseResult.landmarks[0], faceResult.faceLandmarks[0],
          input.videoWidth / input.videoHeight,
        ), input.currentTime * 1000);
        options.onStatus?.(status);
      }
    } catch (error) {
      stop();
      if (options.onError) options.onError(error);
      else console.error('Speech coach vision processing stopped:', error);
    }
    if (running) frame = requestAnimationFrame(tick);
  }

  return {
    start(input) {
      if (disposed) throw new Error('Vision controller has been cleaned up');
      stop();
      recalibrate();
      video = input;
      video.addEventListener('seeking', recalibrate);
      video.addEventListener('emptied', recalibrate);
      video.addEventListener('loadedmetadata', recalibrate);
      video.addEventListener('pause', interrupt);
      video.addEventListener('ended', stop);
      running = true;
      frame = requestAnimationFrame(tick);
    },
    stop,
    recalibrate,
    cleanup() {
      if (disposed) return;
      stop();
      disposed = true;
      try { pose.close(); } finally { face.close(); }
    },
  };
}
