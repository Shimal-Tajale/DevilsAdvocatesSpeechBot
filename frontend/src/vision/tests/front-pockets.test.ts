import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrontPocketEntry } from '../front-pockets.js';
import { VisionAnalysis } from '../analysis.js';
import { measure } from '../measurements.js';
import type { Landmark, Measurements, VisionAlert } from '../types.js';

// Generated image-landmark sequences, not claimed as real webcam observations.
function sample(left: 'sides' | 'pocket' | 'hidden' | 'gesture' | 'near' = 'sides', right = left): Measurements {
  const p = (x: number, y: number, visibility = 0.98): Landmark => ({ x, y, z: 0, visibility });
  const pose: Landmark[] = [];
  pose[11] = p(.4, .35); pose[12] = p(.6, .35);
  pose[23] = p(.43, .67); pose[24] = p(.57, .67);
  pose[7] = p(.46, .24); pose[8] = p(.54, .24);
  for (const [i, mode] of [left, right].entries()) {
    const mirror = (x: number) => i === 0 ? x : 1 - x;
    pose[13 + i] = p(mirror(mode === 'sides' ? .385 : .37), .52);
    pose[15 + i] = mode === 'gesture' ? p(mirror(.35), .42)
      : mode === 'near' ? p(mirror(.43), .68)
      : mode === 'sides' ? p(mirror(.38), .73)
      : p(mirror(.448), .68, mode === 'hidden' ? .1 : .98);
  }
  return { ...measure(pose), headYaw: 0, headPitch: .5 };
}
function setup() {
  const entry = new FrontPocketEntry();
  for (let time = 0; time <= 3000; time += 100) entry.calibrate(sample(), time);
  return entry;
}
function enter(entry: FrontPocketEntry, both = true) {
  entry.update(sample(), 3100);
  for (let t = 3200; t <= 3500; t += 100) entry.update(sample('pocket', both ? 'pocket' : 'sides'), t);
}

test('calibrated sides and wrists resting beside hips never acquire entry evidence', () => {
  const entry = setup();
  for (let t = 3100; t < 10000; t += 100) {
    const s = entry.update(sample(t < 5000 ? 'sides' : 'near'), t);
    assert.equal(s.left.possible, false); assert.equal(s.right.possible, false);
  }
});

test('both observed front-pocket entries require a sustained hold and retain elbow evidence', () => {
  const entry = setup(); enter(entry);
  const early = entry.update(sample('pocket'), 3600);
  assert.equal(early.left.state, 'entered'); assert.equal(early.left.possible, false);
  const held = entry.update(sample('pocket'), 4500);
  assert.equal(held.left.possible, true); assert.equal(held.right.possible, true);
  assert.equal(held.left.elbowSupport, true);
  assert.ok(held.left.inwardTravel! > held.left.requiredInwardTravel);
});

test('one hand entry is tracked without inventing evidence for the other', () => {
  const entry = setup(); enter(entry, false);
  const s = entry.update(sample('pocket', 'sides'), 4500);
  assert.equal(s.left.possible, true); assert.equal(s.right.possible, false);
  assert.equal(s.right.state, 'at_sides');
});

test('natural gestures and unrelated wrist occlusion cannot initiate pocket memory', () => {
  const entry = setup();
  entry.update(sample(), 3100);
  entry.update(sample('gesture'), 3200);
  const s = entry.update(sample('hidden'), 3300);
  assert.equal(s.left.state, 'uncertain'); assert.equal(s.left.confidence, 0);
  assert.equal(s.right.possible, false);
});

test('supported entry followed by occlusion persists briefly and expires without refreshing itself', () => {
  const entry = setup(); enter(entry);
  const s = entry.update(sample('hidden'), 3600);
  assert.equal(s.left.state, 'occluded');
  assert.equal(entry.update(sample('hidden'), 4600).left.possible, true);
  assert.equal(entry.update(sample('hidden'), 7600).left.possible, false);
  assert.equal(entry.update(sample('hidden'), 7700).left.state, 'uncertain');
});

test('occlusion without elbow support or without an observed inward approach cannot be retained', () => {
  const entry = setup();
  const unsupported = sample('pocket'); unsupported.leftElbowAngle = null; unsupported.rightElbowAngle = null;
  entry.update(sample(), 3100);
  entry.update(unsupported, 3200); entry.update(unsupported, 3400);
  assert.equal(entry.update(sample('hidden'), 3500).left.possible, false);
  const early = setup(); early.update(sample(), 3100); early.update(sample('gesture'), 3200);
  assert.equal(early.update(sample('hidden'), 3300).left.state, 'uncertain');
});

test('visible pocket exit clears each hand immediately and interruption clears temporal evidence', () => {
  const entry = setup(); enter(entry);
  assert.equal(entry.update(sample('pocket'), 4500).left.possible, true);
  const exited = entry.update(sample('sides', 'pocket'), 4600);
  assert.equal(exited.left.possible, false); assert.equal(exited.right.possible, true);
  entry.interrupt();
  assert.equal(entry.update(sample('hidden'), 4700).right.possible, false);
});

test('no observed recent transition: static inward wrists and missing calibration are uncertain', () => {
  const entry = setup();
  const s = entry.update(sample('pocket'), 7000);
  assert.equal(s.left.state, 'uncertain'); assert.equal(s.left.possible, false);
  assert.equal(new FrontPocketEntry().update(sample('pocket'), 7000).left.possible, false);
});

test('independent geometry survives one missing wrist and elbow angles are scale-normalized', () => {
  const s = sample('pocket', 'hidden');
  assert.ok(s.leftWristHipHorizontal! > 0); assert.equal(s.rightWristHipHorizontal, undefined);
  assert.ok(s.leftElbowAngle! < 155); assert.equal(s.rightElbowAngle, null);
  assert.ok(s.leftElbowOutward! > 0); assert.equal(s.rightWristVisibility, .1);
});

test('both entries emit only after hold plus alert delay, while one entry does not emit', () => {
  for (const both of [false, true]) {
    const alerts: VisionAlert[] = []; const analysis = new VisionAnalysis(e => alerts.push(e));
    for (let t = 0; t <= 3000; t += 100) analysis.update(sample(), t);
    analysis.update(sample(), 3100);
    for (let t = 3200; t <= 6000; t += 100) analysis.update(sample('pocket', both ? 'pocket' : 'sides'), t);
    assert.equal(alerts.length, 0);
    for (let t = 6100; t <= 6800; t += 100) analysis.update(sample('pocket', both ? 'pocket' : 'sides'), t);
    assert.equal(alerts.length, both ? 1 : 0);
    if (both) assert.deepEqual(alerts[0], { type: 'alert', value: 'hands' });
  }
});

test('brief repeated gestures through the region never satisfy entry hold', () => {
  const entry = setup();
  for (let t = 3100; t <= 10000; t += 100) {
    const s = entry.update(sample(t % 1000 < 400 ? 'pocket' : 'gesture'), t);
    assert.equal(s.left.possible, false); assert.equal(s.right.possible, false);
  }
});

test('live calibration noise increases required travel instead of silently inventing confidence', () => {
  const entry = new FrontPocketEntry();
  for (let t = 0; t <= 3000; t += 100) {
    const s = sample(); s.leftWristInward = t % 200 === 0 ? -.3 : -.1;
    entry.calibrate(s, t);
  }
  const s = entry.update(sample(), 3100);
  assert.ok(s.left.baselineNoise! > .09);
  assert.ok(s.left.requiredInwardTravel > .35);
  entry.reset();
  assert.equal(entry.update(sample('pocket'), 3200).left.baselineSamples, 0);
});
