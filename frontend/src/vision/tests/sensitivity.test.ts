import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VisionAnalysis } from '../analysis.js';
import { RECORDING_POSTURE_ANALYSIS, SENSITIVE_ANALYSIS, handsSummary } from '../sensitivity.js';
import { measure } from '../measurements.js';
import type { AnalysisStatus, Landmark, Measurements, VisionAlert } from '../types.js';

const upright: Measurements = { neckHeight: .5, torsoHeight: 1.5, headYaw: 0, headPitch: .5,
  leftWristVisibility: 1, rightWristVisibility: 1, bodyX: .5, shoulderWidth: .2, handsLow: 0, leftWristX: -.3, leftWristY: 1.5, rightWristX: .3, rightWristY: 1.5 };
function run(sensitive: boolean, motion: (t: number) => Measurements, recording = false) {
  const alerts: VisionAlert[] = [];
  const analysis = new VisionAnalysis(e => alerts.push(e), recording ? RECORDING_POSTURE_ANALYSIS : sensitive ? SENSITIVE_ANALYSIS : {});
  let status!: AnalysisStatus;
  for (let t = 0; t <= 3000; t += 100) analysis.update(upright, t);
  for (let t = 3100; t <= 15000; t += 100) status = analysis.update(motion(t - 3100), t);
  return { status, alerts };
}

test('React configuration detects smaller slouch, sway and fidget without relaxing tracking gates', () => {
  const slouch = () => ({ ...upright, torsoHeight: 1.42 });
  const sway = (t: number) => ({ ...upright, bodyX: .5 + .035 * Math.sin(t * Math.PI / 1200) });
  assert.ok(run(false, slouch, true).alerts.some(e => e.value === 'posture'));
  assert.ok(run(false, sway, true).alerts.some(e => e.value === 'posture'));
  assert.equal(run(false, () => upright, true).alerts.length, 0);
  assert.equal(run(false, () => ({ ...upright, bodyX: .7 }), true).alerts.length, 0);
  const fidget = (t: number) => ({ ...upright, leftWristX: -.3 + .075 * Math.sin(t * Math.PI / 500) });
  assert.ok(run(false, fidget, true).alerts.some(e => e.value === 'hands'));
  assert.equal(run(false, t => ({ ...fidget(t), leftWristVisibility: .4, rightWristVisibility: .4 }), true).alerts.length, 0);
  assert.equal(run(false, () => ({ ...upright, neckHeight: .1 }), true).alerts.length, 0);
  const original = new VisionAnalysis(() => {}).options;
  const configured = new VisionAnalysis(() => {}, RECORDING_POSTURE_ANALYSIS).options;
  for (const key of ['pocketVisibility', 'yawThreshold', 'pitchThreshold', 'cooldownMs', 'sustainedMs'] as const) {
    assert.equal(configured[key], original[key]);
  }
});

test('sensitive preset admits smaller sustained torso compression without using head drop', () => {
  const motion = () => ({ ...upright, torsoHeight: 1.38 });
  assert.ok(run(true, motion).alerts.some(e => e.value === 'posture'));
  assert.equal(run(false, motion).alerts.length, 0);
  assert.equal(run(true, () => ({ ...upright, neckHeight: .1 })).alerts.length, 0);
});

test('smaller slower periodic sway passes sensitive gates while conservative gates reject it', () => {
  const motion = (t: number) => ({ ...upright, bodyX: .5 + .035 * Math.sin(t * Math.PI / 1200) });
  assert.ok(run(true, motion).alerts.some(e => e.value === 'posture'));
  assert.equal(run(false, motion).alerts.length, 0);
  assert.equal(run(true, () => ({ ...upright, bodyX: .7 })).alerts.length, 0);
});

test('smaller repeated wrist movement passes sensitive gates; static and missing wrists do not', () => {
  const motion = (t: number) => ({ ...upright, leftWristX: -.3 + .075 * Math.sin(t * Math.PI / 500) });
  assert.ok(run(true, motion).alerts.some(e => e.value === 'hands'));
  assert.equal(run(false, motion).alerts.length, 0);
  assert.equal(run(true, () => upright).alerts.length, 0);
  assert.equal(run(true, () => ({ ...upright, leftWristX: null, rightWristX: null, handsLow: null })).alerts.length, 0);
});

function pose(pocket: boolean): Landmark[] {
  const points: Landmark[] = [];
  const p = (x: number, y: number): Landmark => ({ x, y, z: 0, visibility: .6 });
  points[11] = p(.4, .35); points[12] = p(.6, .35);
  points[23] = p(.43, .67); points[24] = p(.57, .67);
  points[7] = p(.46, .24); points[8] = p(.54, .24);
  points[15] = p(pocket ? .448 : .38, pocket ? .68 : .73);
  points[16] = p(pocket ? .552 : .62, pocket ? .68 : .73);
  return points;
}

test('relaxed visibility is applied consistently in measurement, wrist baseline and entry gates', () => {
  const alerts: VisionAlert[] = [];
  const analysis = new VisionAnalysis(e => alerts.push(e), SENSITIVE_ANALYSIS);
  const sample = (pocket: boolean) => ({ ...measure(pose(pocket), [], 1, analysis.options.pocketVisibility), headYaw: 0, headPitch: .5 });
  assert.equal(measure(pose(true)).leftPocketRegion, null);
  assert.equal(sample(true).leftPocketRegion, 1);
  for (let t = 0; t <= 3100; t += 100) analysis.update(sample(false), t);
  let status!: AnalysisStatus;
  for (let t = 3200; t <= 7000; t += 100) status = analysis.update(sample(true), t);
  assert.ok(status.debug!.pocketHands!.left.baselineSamples >= 3);
  assert.equal(status.behaviors!.possiblePockets, true);
  assert.deepEqual(alerts, [{ type: 'alert', value: 'hands' }]);
});

test('visible normal positions have a useful status even when pocket calibration is incomplete', () => {
  const analysis = new VisionAnalysis(() => {});
  const status = analysis.update({ ...upright, leftPocketRegion: 0, rightPocketRegion: 0 }, 0);
  assert.match(handsSummary(status), /Hands outside pocket region/);
});
