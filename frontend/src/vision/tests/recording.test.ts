import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RecordingVision } from '../recording.js';
import type { VisionAlert, VisionController } from '../types.js';

function fixture() {
  const calls = { camera: 0, models: 0, start: 0, stop: 0, cleanup: 0, tracks: 0, errors: 0 };
  const sent: VisionAlert[] = [];
  let emit: (event: VisionAlert) => void = () => {};
  const controller: VisionController = {
    start: () => { calls.start++; }, stop: () => { calls.stop++; },
    cleanup: () => { calls.cleanup++; }, recalibrate: () => {},
  };
  const stream = { getTracks: () => [{ stop: () => { calls.tracks++; } }], getVideoTracks: () => [] } as unknown as MediaStream;
  const video = { srcObject: null, play: async () => {}, pause: () => {} } as unknown as HTMLVideoElement;
  const deps = {
    getStream: async () => { calls.camera++; return stream; },
    initialize: async (onAlert: (event: VisionAlert) => void) => {
      calls.models++; emit = onAlert; return controller;
    },
    onAlert: (event: VisionAlert) => sent.push(event),
    onError: () => { calls.errors++; },
  };
  return { calls, sent, stream, video, deps, controller, emit: (event: VisionAlert) => emit(event) };
}

test('one camera/model instance; pause gates events; resume and cleanup are idempotent', async () => {
  const f = fixture();
  const owner = new RecordingVision(f.video, f.deps);
  await Promise.all([owner.start(), owner.start()]);
  assert.equal(f.calls.camera, 1);
  assert.equal(f.calls.models, 1);
  f.emit({ type: 'alert', value: 'posture' });
  owner.setRecording(false);
  f.emit({ type: 'alert', value: 'hands' });
  owner.setRecording(true);
  f.emit({ type: 'alert', value: 'eye_contact' });
  owner.stop(); owner.stop();
  f.emit({ type: 'alert', value: 'hands' });
  assert.deepEqual(f.sent.map(e => e.value), ['posture', 'eye_contact']);
  assert.equal(f.calls.start, 2);
  assert.equal(f.calls.stop, 1);
  assert.equal(f.calls.cleanup, 1);
  assert.equal(f.calls.tracks, 1);
  assert.equal(f.video.srcObject, null);
});

test('camera permission resolving after unmount releases tracks without model initialization', async () => {
  const f = fixture();
  let resolve!: (stream: MediaStream) => void;
  f.deps.getStream = () => new Promise(done => { resolve = done; });
  const owner = new RecordingVision(f.video, f.deps);
  const pending = owner.start();
  owner.stop(); resolve(f.stream); await pending;
  assert.equal(f.calls.models, 0);
  assert.equal(f.calls.tracks, 1);
});

test('models resolving after unmount are cleaned up and never started', async () => {
  const f = fixture();
  let resolve!: (controller: VisionController) => void;
  let initialized!: () => void;
  const ready = new Promise<void>(done => { initialized = done; });
  f.deps.initialize = () => { initialized(); return new Promise(done => { resolve = done; }); };
  const owner = new RecordingVision(f.video, f.deps);
  const pending = owner.start();
  await ready; owner.stop(); resolve(f.controller); await pending;
  assert.equal(f.calls.start, 0);
  assert.equal(f.calls.cleanup, 1);
  assert.equal(f.calls.tracks, 1);
});

test('model failure releases the camera and reports a nonfatal vision error', async () => {
  const f = fixture();
  f.deps.initialize = async () => { throw new Error('model unavailable'); };
  await new RecordingVision(f.video, f.deps).start();
  assert.equal(f.calls.errors, 1);
  assert.equal(f.calls.tracks, 1);
  assert.equal(f.video.srcObject, null);
});

test('camera denial reports a nonfatal error without loading models', async () => {
  const f = fixture();
  f.deps.getStream = async () => { throw new Error('denied'); };
  await new RecordingVision(f.video, f.deps).start();
  assert.equal(f.calls.models, 0);
  assert.equal(f.calls.errors, 1);
});
