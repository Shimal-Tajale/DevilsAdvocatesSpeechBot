import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VisionAnalysis } from '../.build/analysis.js';
import { describeAnalysis, drawTorsoHistory, handsObservable } from '../.build/demo/diagnostics.js';

const raw = { neckHeight: .5, torsoHeight: 1.5, bodyX: .5, shoulderWidth: .2, handsLow: 0,
  headYaw: 0, headPitch: .5, shoulderMidX: .5, hipMidX: .5, torsoOffset: 0, torsoLean: 0 };

test('diagnostic panel includes raw and smoothed values, uncertainty, thresholds and timing', () => {
  const analysis = new VisionAnalysis(() => {});
  let status;
  for (let t = 0; t <= 3500; t += 100) status = analysis.update(raw, t);
  const text = describeAnalysis(status);
  for (const label of ['Shoulder midpoint X', 'Hip midpoint X', 'Torso lean angle', 'Wrist range',
    'raw → smoothed', 'Uncertain', 'CALIBRATION BASELINE', 'ACTIVE THRESHOLDS',
    'cooldown', 'active', 'FRONT POCKET ENTRY', 'preview mirrored']) assert.ok(text.includes(label), label);
});

test('long inference gaps are visible and clear historical movement', () => {
  const analysis = new VisionAnalysis(() => {});
  for (let t = 0; t <= 4000; t += 100) analysis.update(raw, t);
  const status = analysis.update(raw, 5000);
  assert.match(describeAnalysis(status), /Frame gap exceeded limit/);
  assert.equal(status.debug.historySamples, 1);
  assert.equal(status.behaviors.swaying, false);
});

test('torso plot draws both translation and relative movement and clears missing history', () => {
  const calls = [];
  const ctx = Object.fromEntries(['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke'].map(k => [k, (...args) => calls.push([k, ...args])]));
  const canvas = { width: 600, height: 160, getContext: () => ctx };
  drawTorsoHistory(canvas, { debug: { torsoHistory: [{ time: 0, translation: 0, relative: 0 }, { time: 100, translation: .2, relative: -.2 }] } });
  assert.equal(calls.filter(c => c[0] === 'stroke').length, 3);
  calls.length = 0;
  drawTorsoHistory(canvas, {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'clearRect');
});


test('supported temporal front-pocket state stays displayable while both wrists are occluded', () => {
  const hidden = { ...raw, handsLow: null, leftWristX: null, rightWristX: null };
  assert.equal(handsObservable({ measurements: hidden, behaviors: { possiblePockets: true } }), true);
  assert.equal(handsObservable({ measurements: hidden, behaviors: { possiblePockets: false } }), false);
});
