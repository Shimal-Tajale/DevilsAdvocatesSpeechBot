import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VisionAnalysis } from '../analysis.js';
import { measure } from '../measurements.js';
import type { Landmark, Measurements, VisionAlert } from '../types.js';

const upright: Measurements = {
  neckHeight: 0.5, torsoHeight: 1.5, bodyX: 0.5, shoulderWidth: 0.2,
  handsLow: 0, headYaw: 0, headPitch: 0.5,
};
const hidden: Measurements = Object.fromEntries(
  Object.keys(upright).map(key => [key, null]),
) as unknown as Measurements;

function setup(smoothingMs = 1) {
  const alerts: VisionAlert[] = [];
  const analysis = new VisionAnalysis(event => alerts.push(event), { smoothingMs });
  return { analysis, alerts };
}
function calibrate(analysis: VisionAnalysis) {
  for (let time = 0; time < 3000; time += 100) {
    const status = analysis.update(upright, time);
    assert.equal(status.calibrated, false);
  }
  assert.equal(analysis.update(upright, 3000).calibrated, true);
}
function feed(analysis: VisionAnalysis, sample: Measurements, from: number, to: number) {
  for (let time = from; time <= to; time += 100) analysis.update(sample, time);
}

test('three seconds of valid calibration are required; no alerts during calibration', () => {
  const { analysis, alerts } = setup();
  calibrate(analysis);
  assert.equal(alerts.length, 0);
});

test('invalid frames and large gaps do not advance calibration', () => {
  const { analysis } = setup();
  analysis.update(upright, 0);
  assert.equal(analysis.update(upright, 1000).calibrationProgress, 0);
  analysis.update(hidden, 1100);
  assert.equal(analysis.update(upright, 1200).calibrationProgress, 0);
  assert.ok(analysis.update(upright, 1300).calibrationProgress > 0);
});

test('alerts wait two seconds and each type has an independent twelve second cooldown', () => {
  const { analysis, alerts } = setup();
  calibrate(analysis);
  const bad = { ...upright, neckHeight: 0.1, torsoHeight: 1.1, handsLow: 1, headYaw: 0.6 };
  feed(analysis, bad, 3100, 5000);
  assert.equal(alerts.length, 0);
  analysis.update(bad, 5100);
  assert.deepEqual(alerts.map(event => event.value), ['posture', 'eye_contact']);
  feed(analysis, bad, 5200, 17000);
  assert.equal(alerts.length, 2);
  analysis.update(bad, 17100);
  assert.equal(alerts.length, 4);
  assert.ok(alerts.every(event => event.type === 'alert'));
});

test('short deviations and recovery reset sustained timing', () => {
  const { analysis, alerts } = setup();
  calibrate(analysis);
  const bad = { ...upright, neckHeight: 0.1, torsoHeight: 1.1 };
  feed(analysis, bad, 3100, 4500);
  analysis.update(upright, 4600);
  feed(analysis, bad, 4700, 6600);
  assert.equal(alerts.length, 0);
  analysis.update(bad, 6700);
  assert.deepEqual(alerts, [{ type: 'alert', value: 'posture' }]);
});

test('tracking loss, interruption, and frame gaps break sustained timing', () => {
  for (const interruption of ['missing', 'pause', 'gap']) {
    const { analysis, alerts } = setup();
    calibrate(analysis);
    const bad = { ...upright, neckHeight: 0.1, torsoHeight: 1.1 };
    feed(analysis, bad, 3100, 4500);
    if (interruption === 'missing') analysis.update(hidden, 4600);
    if (interruption === 'pause') analysis.interrupt();
    const restart = interruption === 'gap' ? 6000 : 4700;
    feed(analysis, bad, restart, restart + 1900);
    assert.equal(alerts.length, 0, interruption);
    analysis.update(bad, restart + 2000);
    assert.equal(alerts.length, 1, interruption);
  }
});

test('backward replay time resets baseline and cooldowns', () => {
  const { analysis } = setup();
  calibrate(analysis);
  const status = analysis.update(upright, 0);
  assert.equal(status.calibrated, false);
  assert.equal(status.calibrationProgress, 0);
});

test('sustained swaying produces posture alerts', () => {
  const { analysis, alerts } = setup();
  calibrate(analysis);
  for (let time = 3100; time <= 11500; time += 100) {
    analysis.update({ ...upright, bodyX: time % 400 < 200 ? 0.35 : 0.65 }, time);
  }
  assert.deepEqual(alerts, [{ type: 'alert', value: 'posture' }]);
});

test('a single body translation does not count as sustained swaying', () => {
  const { analysis, alerts } = setup();
  calibrate(analysis);
  analysis.update(upright, 3100);
  feed(analysis, { ...upright, bodyX: 0.8 }, 3200, 7000);
  assert.equal(alerts.length, 0);
});

test('EMA reduces a one-frame measurement spike', () => {
  const { analysis, alerts } = setup(250);
  calibrate(analysis);
  const status = analysis.update({ ...upright, headYaw: 1 }, 3100);
  assert.ok(status.measurements.headYaw! > 0 && status.measurements.headYaw! < 1);
  feed(analysis, upright, 3200, 6000);
  assert.equal(alerts.length, 0);
});

test('missing face and missing body do not invent negative behavior', () => {
  const { analysis, alerts } = setup();
  calibrate(analysis);
  feed(analysis, hidden, 3100, 10000);
  assert.equal(alerts.length, 0);
});

test('options and timestamps are validated', () => {
  assert.throws(() => new VisionAnalysis(() => {}, { sustainedMs: 0 }));
  assert.throws(() => setup().analysis.update(upright, NaN));
});

const point = (x: number, y: number, visibility = 1): Landmark => ({ x, y, z: 0, visibility });
function poseFixture(): Landmark[] {
  const pose: Landmark[] = [];
  pose[11] = point(0.4, 0.4); pose[12] = point(0.6, 0.4);
  pose[7] = point(0.45, 0.3); pose[8] = point(0.55, 0.3);
  pose[23] = point(0.45, 0.7); pose[24] = point(0.55, 0.7);
  return pose;
}

test('landmarks produce scale-normalized posture and hidden/low hand measurements', () => {
  const pose = poseFixture();
  const sample = measure(pose);
  assert.ok(Math.abs(sample.neckHeight! - 0.5) < 1e-10);
  assert.ok(Math.abs(sample.torsoHeight! - 1.5) < 1e-10);
  assert.equal(sample.handsLow, null);
  pose[16] = point(0.6, 0.8);
  pose[15] = point(0.4, 0.45);
  assert.equal(measure(pose).handsLow, 0);
  pose[15] = point(0.4, 0.8);
  assert.equal(measure(pose).handsLow, 1);
  assert.equal(measure([]).handsLow, null);
  pose[11].visibility = 0.1;
  assert.equal(measure(pose).handsLow, null);
});

test('head orientation is measured relative to the eye line with aspect correction', () => {
  const face: Landmark[] = [];
  face[33] = point(0.4, 0.3); face[263] = point(0.6, 0.3);
  face[1] = point(0.5, 0.4);
  const sample = measure([], face, 2);
  assert.equal(sample.headYaw, 0);
  assert.ok(Math.abs(sample.headPitch! - 0.25) < 1e-10);
  face[1].x = 0.6;
  assert.ok(measure([], face, 2).headYaw! > 0.4);
});

test('MediaPipe face visibility=0 does not reject valid face coordinates or block calibration', () => {
  const face: Landmark[] = [];
  face[33] = point(0.4, 0.3, 0); face[263] = point(0.6, 0.3, 0);
  face[1] = point(0.5, 0.4, 0);
  const sample = measure(poseFixture(), face);
  assert.equal(sample.headYaw, 0);
  assert.ok(sample.headPitch !== null);
  const { analysis } = setup();
  for (let time = 0; time < 3000; time += 100) analysis.update(sample, time);
  const status = analysis.update(sample, 3000);
  assert.equal(status.calibrationProgress, 1);
  assert.equal(status.calibrated, true);
  assert.deepEqual(status.calibrationBlockers, []);
});

test('non-finite face coordinates remain unknown', () => {
  const face: Landmark[] = [];
  face[33] = point(0.4, 0.3, 0); face[263] = point(0.6, 0.3, 0);
  face[1] = point(NaN, 0.4, 0);
  assert.equal(measure([], face).headYaw, null);
});

test('calibration diagnostics distinguish missing face, posture, and excessive frame gaps', () => {
  const { analysis } = setup();
  assert.deepEqual(analysis.update({ ...upright, headYaw: null }, 0).calibrationBlockers, ['face']);
  assert.deepEqual(analysis.update({ ...upright, torsoHeight: null }, 100).calibrationBlockers, ['torso']);
  assert.deepEqual(analysis.update({ ...upright, neckHeight: 0 }, 1000).calibrationBlockers, ['neck', 'frame_gap']);
  assert.equal(analysis.update(upright, 1100).calibrationProgress, 0);
});

const tracked = { ...upright, leftWristVisibility: 1, rightWristVisibility: 1, leftWristX: -0.2, rightWristX: 0.2,
  leftWristY: 1.3, rightWristY: 1.3, pocketProximity: 0 };

test('upright and hands naturally at sides remain normal even with legacy handsLow', () => {
  const { analysis, alerts } = setup(); calibrate(analysis);
  feed(analysis, { ...tracked, handsLow: 1 }, 3100, 18000);
  assert.equal(alerts.length, 0);
});

test('static pocket flag without a calibrated wrist-entry trajectory cannot trigger', () => {
  const { analysis, alerts } = setup(); calibrate(analysis);
  feed(analysis, { ...tracked, pocketProximity: 1 }, 3100, 9000);
  assert.equal(alerts.length, 0);
  const status = analysis.update({ ...tracked, pocketProximity: 1 }, 9100);
  assert.equal(status.behaviors?.possiblePockets, false);
  assert.equal(status.debug?.pocketHands?.left.state, 'uncertain');
  feed(analysis, hidden, 9200, 15000);
  assert.equal(alerts.length, 0);
});

test('repetitive wrist motion triggers fidgeting with cooldown, occasional gestures do not', () => {
  for (const repetitive of [true, false]) {
    const { analysis, alerts } = setup(); calibrate(analysis);
    for (let time = 3100; time <= 15000; time += 100) {
      const x = repetitive ? 0.3 * Math.sin(time * Math.PI / 400)
        : 0.3 * Math.sin(time * Math.PI / 4000);
      analysis.update({ ...tracked, leftWristX: x }, time);
    }
    assert.equal(alerts.length, repetitive ? 1 : 0);
  }
});

test('pocket geometry rejects relaxed sides, gestures, occlusion and out-of-frame wrists', () => {
  const pose = poseFixture();
  pose[15] = point(0.4, 0.8); pose[16] = point(0.6, 0.8);
  assert.equal(measure(pose).pocketProximity, 0);
  pose[15] = point(0.465, 0.68); pose[16] = point(0.535, 0.68);
  assert.equal(measure(pose).pocketProximity, 1);
  pose[15].visibility = 0.1;
  assert.equal(measure(pose).pocketProximity, null);
  pose[15] = point(0.46, 1.1);
  assert.equal(measure(pose).pocketProximity, null);
});

test('moderate normalized slouch is detected with default smoothing after sustained time', () => {
  const { analysis, alerts } = setup(250); calibrate(analysis);
  feed(analysis, { ...upright, neckHeight: 0.39, torsoHeight: 1.27 }, 3100, 6500);
  assert.equal(alerts.length, 1);
  analysis.reset();
  assert.equal(analysis.update(upright, 6600).calibrated, false);
});

test('broad repeated speaking gestures are not small fidgets', () => {
  const { analysis, alerts } = setup(); calibrate(analysis);
  for (let time = 3100; time <= 15000; time += 100) {
    analysis.update({ ...tracked, leftWristX: Math.sin(time * Math.PI / 500) }, time);
  }
  assert.equal(alerts.length, 0);
});

test('missing wrists break repetitive-motion evidence and recalibration clears it', () => {
  const { analysis } = setup(); calibrate(analysis);
  let status = analysis.update(tracked, 3100);
  for (let time = 3200; time <= 9200; time += 100) {
    status = analysis.update({ ...tracked, leftWristX: 0.3 * Math.sin(time * Math.PI / 400) }, time);
  }
  assert.equal(status.behaviors?.fidgeting, true);
  status = analysis.update({ ...tracked, leftWristX: null, rightWristX: null }, 9300);
  assert.equal(status.behaviors?.fidgeting, false);
  analysis.reset();
  status = analysis.update(tracked, 9400);
  assert.equal(status.calibrated, false);
  assert.equal(status.diagnostics?.wristReversals, 0);
});


test('front-facing pocket geometry is independent of anatomical left/right order and mirroring', () => {
  for (const mirror of [false, true]) {
    const pose = poseFixture();
    pose[15] = point(0.465, 0.68); pose[16] = point(0.535, 0.68);
    if (mirror) for (const p of pose.filter(Boolean)) p.x = 1 - p.x;
    assert.equal(measure(pose).pocketProximity, 1);
    pose[15].y = 0.76; pose[16].y = 0.76;
    assert.equal(measure(pose).pocketProximity, 0);
  }
});

test('wrists beside hips, crossed hands and uncertain tracking are not pocket evidence', () => {
  const pose = poseFixture();
  for (const [leftX, rightX, y] of [[0.44, 0.56, 0.68], [0.45, 0.55, 0.72], [0.53, 0.47, 0.68]]) {
    pose[15] = point(leftX, y); pose[16] = point(rightX, y);
    assert.equal(measure(pose).pocketProximity, 0);
  }
  pose[15] = point(0.465, 0.68, 0.6); pose[16] = point(0.535, 0.68);
  assert.equal(measure(pose).pocketProximity, null);
});

test('front-facing body ratios and wrist coordinates ignore translation, scale and camera roll', () => {
  const pose = poseFixture();
  pose[15] = point(0.465, 0.68); pose[16] = point(0.535, 0.68);
  const original = measure(pose);
  const angle = 0.15;
  const transformed = pose.map(p => {
    const x = p.x - 0.5, y = p.y - 0.5;
    return point(0.55 + 0.8 * (x * Math.cos(angle) - y * Math.sin(angle)),
      0.5 + 0.8 * (x * Math.sin(angle) + y * Math.cos(angle)));
  });
  const result = measure(transformed);
  for (const key of ['neckHeight', 'torsoHeight', 'leftWristX', 'leftWristY'] as const) {
    assert.ok(Math.abs(result[key]! - original[key]!) < 1e-10, key);
  }
  assert.equal(result.pocketProximity, 1);
});


test('without hands-at-sides calibration, later static hip positions stay uncertain', () => {
  const { analysis, alerts } = setup(); calibrate(analysis);
  const pose = poseFixture();
  const sample = () => ({ ...measure(pose), headYaw: 0, headPitch: 0.5 });
  pose[15] = point(0.44, 0.73); pose[16] = point(0.56, 0.73);
  feed(analysis, sample(), 3100, 10000);
  assert.equal(alerts.length, 0);
  pose[15] = point(0.465, 0.68); pose[16] = point(0.535, 0.68);
  feed(analysis, sample(), 10100, 13000);
  pose[15] = point(0.44, 0.73); pose[16] = point(0.56, 0.73);
  analysis.update(sample(), 13100);
  pose[15] = point(0.465, 0.68); pose[16] = point(0.535, 0.68);
  feed(analysis, sample(), 13200, 19100);
  assert.equal(alerts.length, 0);
  analysis.update(sample(), 19200);
  assert.equal(alerts.length, 0);
});
