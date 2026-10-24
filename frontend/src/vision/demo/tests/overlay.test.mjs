import assert from 'node:assert/strict';
import { test } from 'node:test';
import { containRect, drawLandmarks } from '../.build/demo/overlay.js';
import { describeFrame } from '../.build/demo/diagnostics.js';

function context() {
  const calls = [];
  const ctx = Object.fromEntries(['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill']
    .map(name => [name, (...args) => calls.push([name, ...args])]));
  return { ctx, calls };
}
const point = (x, y, visibility = 1) => ({ x, y, z: 0, visibility });
const frame = overrides => ({
  pose: [], face: [], width: 1600, height: 900,
  videoTimeMs: 1000, frameGapMs: 100, inferenceMs: 30, ...overrides,
});

test('contain mapping handles wide video, tall video and responsive resizing', () => {
  assert.deepEqual(containRect(400, 300, 1600, 900), { x: 0, y: 37.5, width: 400, height: 225 });
  assert.deepEqual(containRect(400, 300, 600, 900), { x: 100, y: 0, width: 200, height: 300 });
  assert.deepEqual(containRect(800, 600, 1600, 900), { x: 0, y: 75, width: 800, height: 450 });
});

test('pose dots and skeleton share contain coordinates without a second JS mirror', () => {
  const { ctx, calls } = context();
  const pose = [];
  pose[11] = point(0.25, 0.5); pose[12] = point(0.75, 0.5);
  drawLandmarks(ctx, frame({ pose }), 400, 300);
  assert.ok(calls.some(call => call[0] === 'moveTo' && call[1] === 100 && call[2] === 150));
  assert.ok(calls.some(call => call[0] === 'lineTo' && call[1] === 300 && call[2] === 150));
  const dots = calls.filter(call => call[0] === 'arc');
  assert.deepEqual(dots.map(call => call.slice(1, 3)), [[100, 150], [300, 150]]);
});

test('low-confidence pose points do not connect and face visibility=0 can still draw', () => {
  const { ctx, calls } = context();
  const pose = [], face = [];
  pose[11] = point(0.25, 0.5, 0.1); pose[12] = point(0.75, 0.5);
  face[1] = point(0.5, 0.25, 0);
  drawLandmarks(ctx, frame({ pose, face }), 400, 300);
  assert.equal(calls.filter(call => call[0] === 'lineTo').length, 0);
  assert.equal(calls.filter(call => call[0] === 'arc').length, 3);
});

test('missing detections clear stale dots and invalid/outside points are skipped', () => {
  const { ctx, calls } = context();
  drawLandmarks(ctx, frame(), 400, 300);
  assert.deepEqual(calls[0], ['clearRect', 0, 0, 400, 300]);
  assert.equal(calls.filter(call => call[0] === 'arc').length, 0);
  drawLandmarks(ctx, frame({ pose: [point(NaN, 0), point(2, 0.5)] }), 400, 300);
  assert.equal(calls.filter(call => call[0] === 'arc').length, 0);
});

test('diagnostics distinguish absent face detections from a face with zero visibility', () => {
  assert.match(describeFrame(frame()), /No face returned/);
  const face = [];
  face[1] = point(0.5, 0.5, 0); face[33] = point(0.4, 0.4, 0); face[263] = point(0.6, 0.4, 0);
  const text = describeFrame(frame({ face }));
  assert.match(text, /3\/264 finite points/);
  assert.match(text, /per-point visibility is not used/);
  assert.doesNotMatch(text, /No face returned/);
});
