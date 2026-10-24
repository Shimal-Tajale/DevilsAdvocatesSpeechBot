import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { initializeVision } from '../controller.js';
import type { LandmarkFrame, VisionController, VisionOptions } from '../types.js';

class FakeVideo extends EventTarget {
  paused = false;
  ended = false;
  seeking = false;
  readyState = 2;
  videoWidth = 640;
  videoHeight = 480;
  currentTime = 0;
  get element(): HTMLVideoElement { return this as unknown as HTMLVideoElement; }
}

let callbacks: Map<number, FrameRequestCallback>;
let nextId: number;
let controller: VisionController | undefined;
const rafDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
const cancelDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
const poseDetect = mock.fn(() => ({ landmarks: [] }));
const faceDetect = mock.fn(() => ({ faceLandmarks: [] }));
const poseClose = mock.fn();
const faceClose = mock.fn();

beforeEach(() => {
  callbacks = new Map(); nextId = 0; controller = undefined;
  poseDetect.mock.resetCalls(); faceDetect.mock.resetCalls();
  poseClose.mock.resetCalls(); faceClose.mock.resetCalls();
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true, value: (callback: FrameRequestCallback) => {
      callbacks.set(++nextId, callback); return nextId;
    },
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true, value: (id: number) => { callbacks.delete(id); },
  });
  mock.method(FilesetResolver, 'forVisionTasks', async () => ({}));
  mock.method(PoseLandmarker, 'createFromOptions', async () => ({
    detectForVideo: poseDetect, close: poseClose,
  }));
  mock.method(FaceLandmarker, 'createFromOptions', async () => ({
    detectForVideo: faceDetect, close: faceClose,
  }));
});

afterEach(() => {
  controller?.cleanup();
  mock.restoreAll();
  if (rafDescriptor) Object.defineProperty(globalThis, 'requestAnimationFrame', rafDescriptor);
  else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  if (cancelDescriptor) Object.defineProperty(globalThis, 'cancelAnimationFrame', cancelDescriptor);
  else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
});

const options = (): VisionOptions => ({
  wasmRoot: '/wasm', poseModelPath: '/pose.task', faceModelPath: '/face.task',
  onAlert: () => {},
});

function frame(time: number) {
  const pending = [...callbacks.values()];
  callbacks.clear();
  for (const callback of pending) callback(time);
}

test('video processing skips duplicate/paused frames and stops scheduling on stop', async () => {
  controller = await initializeVision(options());
  const video = new FakeVideo();
  controller.start(video.element);
  frame(0);
  assert.equal(poseDetect.mock.callCount(), 1);
  assert.equal(faceDetect.mock.callCount(), 1);
  frame(100);
  assert.equal(poseDetect.mock.callCount(), 1);
  video.currentTime = 0.1;
  frame(200);
  assert.equal(poseDetect.mock.callCount(), 2);
  video.paused = true;
  video.dispatchEvent(new Event('pause'));
  video.currentTime = 0.2;
  frame(300);
  assert.equal(poseDetect.mock.callCount(), 2);
  controller.stop();
  assert.equal(callbacks.size, 0);
  controller.start(video.element);
  controller.cleanup(); controller.cleanup();
  assert.equal(poseClose.mock.callCount(), 1);
  assert.equal(faceClose.mock.callCount(), 1);
  assert.equal(callbacks.size, 0);
  assert.throws(() => controller!.start(video.element), /cleaned up/);
});

test('seeking resets analysis while inference timestamps keep increasing', async () => {
  controller = await initializeVision(options());
  const video = new FakeVideo();
  const times: number[] = [];
  controller.start(video.element);
  frame(0);
  video.currentTime = 10;
  frame(100);
  video.currentTime = 0;
  video.dispatchEvent(new Event('seeking'));
  frame(200);
  for (const call of poseDetect.mock.calls) {
    times.push((call.arguments as unknown as [HTMLVideoElement, number])[1]);
  }
  assert.equal(times.length, 3);
  assert.ok(times[1] > times[0]);
  assert.ok(times[2] > times[1]);
});

test('initialization failure closes the already-created pose model', async () => {
  mock.method(FaceLandmarker, 'createFromOptions', async () => { throw new Error('model load'); });
  await assert.rejects(initializeVision(options()), /model load/);
  assert.equal(poseClose.mock.callCount(), 1);
});

test('inference failure stops the loop and reaches onError', async () => {
  const errors: unknown[] = [];
  mock.method(PoseLandmarker, 'createFromOptions', async () => ({
    detectForVideo: () => { throw new Error('inference failed'); }, close: poseClose,
  }));
  controller = await initializeVision({ ...options(), onError: error => errors.push(error) });
  controller.start(new FakeVideo().element);
  frame(0);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /inference failed/);
  assert.equal(callbacks.size, 0);
});

test('landmark callback reuses existing detections with frame dimensions and timing', async () => {
  const posePoints = [{ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }];
  const facePoints = [{ x: 0.4, y: 0.4, z: 0, visibility: 0 }];
  const poseInference = mock.fn(() => ({ landmarks: [posePoints] }));
  const faceInference = mock.fn(() => ({ faceLandmarks: [facePoints] }));
  mock.method(PoseLandmarker, 'createFromOptions', async () => ({
    detectForVideo: poseInference, close: poseClose,
  }));
  mock.method(FaceLandmarker, 'createFromOptions', async () => ({
    detectForVideo: faceInference, close: faceClose,
  }));
  const frames: LandmarkFrame[] = [];
  controller = await initializeVision({ ...options(), onLandmarks: result => frames.push(result) });
  const video = new FakeVideo();
  controller.start(video.element);
  frame(0);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].pose, posePoints);
  assert.equal(frames[0].face, facePoints);
  assert.equal(frames[0].width, 640);
  assert.equal(frames[0].height, 480);
  assert.equal(frames[0].frameGapMs, null);
  assert.ok(frames[0].inferenceMs >= 0);
  video.currentTime = 0.1;
  frame(100);
  assert.equal(frames[1].videoTimeMs, 100);
  assert.equal(frames[1].frameGapMs, 100);
  assert.equal(poseInference.mock.callCount(), 2);
  assert.equal(faceInference.mock.callCount(), 2);
  controller.stop();
  frame(200);
  assert.equal(frames.length, 2);
});
