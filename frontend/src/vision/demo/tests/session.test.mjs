import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebcamSession } from '../.build/demo/session.js';
import { explainError } from '../.build/demo/errors.js';

function deferred() {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
}

function fixture(overrides = {}) {
  const track = new EventTarget();
  track.stops = 0;
  track.stop = () => { track.stops++; };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const video = { srcObject: null, play: async () => {}, pause: () => {} };
  const model = {
    starts: 0, closes: 0, resets: 0,
    start() { this.starts++; },
    cleanup() { this.closes++; },
    recalibrate() { this.resets++; },
  };
  const errors = [], states = [], alerts = [], landmarks = [];
  const options = {
    wasmRoot: '/wasm', poseModelPath: '/pose', faceModelPath: '/face',
    onAlert: alert => alerts.push(alert),
    onLandmarks: frame => landmarks.push(frame),
  };
  let callbacks;
  const deps = {
    getStream: async () => stream,
    checkAssets: async () => {},
    initialize: async options => { callbacks = options; return model; },
    onState: state => states.push(state),
    onError: error => errors.push(error),
    ...overrides,
  };
  const session = new WebcamSession(video, options, deps);
  return { session, video, stream, track, model, errors, states, alerts, landmarks,
    get callbacks() { return callbacks; } };
}

test('start attaches a webcam and existing controller; stop releases resources', async () => {
  const f = fixture();
  await f.session.start();
  assert.equal(f.video.srcObject, f.stream);
  assert.equal(f.model.starts, 1);
  assert.equal(f.states.at(-1), 'running');
  f.session.recalibrate();
  assert.equal(f.model.resets, 1);
  f.session.stop();
  f.session.stop();
  assert.equal(f.model.closes, 1);
  assert.equal(f.track.stops, 1);
  assert.equal(f.video.srcObject, null);
});

test('stop during permission request releases a stream delivered later', async () => {
  const camera = deferred();
  const f = fixture({ getStream: () => camera.promise });
  const pending = f.session.start();
  f.session.stop();
  camera.resolve(f.stream);
  await pending;
  assert.equal(f.track.stops, 1);
  assert.equal(f.model.starts, 0);
  assert.equal(f.video.srcObject, null);
  assert.equal(f.states.at(-1), 'stopped');
});

test('stop during model loading closes late models without starting them', async () => {
  const loading = deferred(), entered = deferred();
  const f = fixture({ initialize: () => { entered.resolve(); return loading.promise; } });
  const pending = f.session.start();
  await entered.promise;
  f.session.stop();
  assert.equal(f.track.stops, 1);
  loading.resolve(f.model);
  await pending;
  assert.equal(f.model.starts, 0);
  assert.equal(f.model.closes, 1);
  assert.equal(f.states.at(-1), 'stopped');
});

test('stop aborts pending asset checks and ignores their stale rejection', async () => {
  const entered = deferred();
  const f = fixture({ checkAssets: signal => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    entered.resolve();
  }) });
  const pending = f.session.start();
  await entered.promise;
  f.session.stop();
  await pending;
  assert.equal(f.track.stops, 1);
  assert.equal(f.errors.length, 0);
  assert.equal(f.model.starts, 0);
});

test('missing assets release the camera and display the original error', async () => {
  const missing = new Error('Missing asset (HTTP 404): /demo/assets/face_landmarker.task');
  const f = fixture({ checkAssets: async () => { throw missing; } });
  await f.session.start();
  assert.deepEqual(f.errors, [missing]);
  assert.equal(f.track.stops, 1);
  assert.equal(f.video.srcObject, null);
  assert.equal(f.model.starts, 0);
});

test('permission failures are reported and allow retry', async () => {
  const denied = new DOMException('Permission denied', 'NotAllowedError');
  const f = fixture({ getStream: async () => { throw denied; } });
  await f.session.start();
  assert.deepEqual(f.errors, [denied]);
  assert.equal(f.states.at(-1), 'stopped');
  assert.equal(f.model.starts, 0);
  assert.match(explainError(denied), /Allow camera access/);
});

test('inference errors stop processing and discard callbacks from a stopped run', async () => {
  const f = fixture();
  await f.session.start();
  const event = { type: 'alert', value: 'hands' };
  f.callbacks.onAlert(event);
  const failure = new Error('Inference failed');
  f.callbacks.onError(failure);
  f.callbacks.onAlert(event);
  assert.deepEqual(f.alerts, [event]);
  assert.deepEqual(f.errors, [failure]);
  assert.equal(f.model.closes, 1);
  assert.equal(f.track.stops, 1);
});

test('camera disconnection releases resources and reports a useful error', async () => {
  const f = fixture();
  await f.session.start();
  f.track.dispatchEvent(new Event('ended'));
  assert.equal(f.states.at(-1), 'stopped');
  assert.equal(f.track.stops, 1);
  assert.equal(f.model.closes, 1);
  assert.match(f.errors[0].message, /disconnected/);
});

test('camera tracks are released even when model cleanup throws', async () => {
  const f = fixture();
  await f.session.start();
  f.model.cleanup = () => { throw new Error('cleanup failed'); };
  assert.throws(() => f.session.stop(), /cleanup failed/);
  assert.equal(f.track.stops, 1);
  assert.equal(f.video.srcObject, null);
  assert.equal(f.states.at(-1), 'stopped');
});

test('camera and asset errors have actionable explanations', () => {
  assert.match(explainError(new DOMException('none', 'NotFoundError')), /No webcam/);
  assert.match(explainError(new DOMException('busy', 'NotReadableError')), /Close other apps/);
  assert.match(explainError(new Error('Missing asset')), /node demo\/setup-assets.mjs/);
});

test('landmark callback forwards original results only during the active camera run', async () => {
  const f = fixture();
  await f.session.start();
  const result = { pose: [], face: [], width: 640, height: 480 };
  f.callbacks.onLandmarks(result);
  assert.equal(f.landmarks[0], result);
  f.session.stop();
  f.callbacks.onLandmarks(result);
  assert.equal(f.landmarks.length, 1);
});
