import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measure } from '../measurements.js';
import { FrontPocketEntry } from '../front-pockets.js';
import { VisionAnalysis } from '../analysis.js';
import { SENSITIVE_ANALYSIS, handsSummary } from '../sensitivity.js';
import type { Landmark, VisionAlert } from '../types.js';

// Approximate overlay positions read visually from the supplied screenshot,
// mapped through its 833×625 displayed video rectangle. These are not exported
// MediaPipe values, visibility scores, or an observed entry trajectory.
function sample(pockets: boolean, straightElbows = false) {
  const pose: Landmark[] = [];
  const p = (x: number, y: number): Landmark => ({ x: (x - 189) / 833, y: (y - 304) / 625, z: 0, visibility: .95 });
  pose[11] = p(530, 536); pose[12] = p(707, 536);
  pose[23] = p(580, 814); pose[24] = p(670, 814);
  pose[7] = p(590, 430); pose[8] = p(650, 430);
  pose[15] = pockets ? p(558, 790) : p(510, 850);
  pose[16] = pockets ? p(693, 790) : p(740, 850);
  pose[13] = p(515, 673); pose[14] = p(730, 683);
  if (straightElbows) for (const i of [0, 1]) pose[13 + i] = {
    ...pose[13 + i], x: (pose[11 + i].x + pose[15 + i].x) / 2,
    y: (pose[11 + i].y + pose[15 + i].y) / 2,
  };
  return { ...measure(pose, [], 833 / 625, .55), headYaw: 0, headPitch: .5 };
}

test('screenshot-like front openings outside hip landmarks were rejected by the old geometry', () => {
  const raw = sample(true);
  assert.ok(raw.leftWristInward! < -.1); assert.ok(raw.rightWristInward! < -.1);
  assert.equal(raw.leftPocketRegion, 0); assert.equal(raw.rightPocketRegion, 0);
  assert.equal(raw.leftFrontPocketRegion, 1); assert.equal(raw.rightFrontPocketRegion, 1);
  assert.ok(raw.leftElbowAngle! < 155); assert.ok(raw.rightElbowAngle! < 155);
});

test('screenshot-like endpoint qualifies after calibrated inward entry, hold and sustained delay', () => {
  const alerts: VisionAlert[] = [];
  const analysis = new VisionAnalysis(e => alerts.push(e), SENSITIVE_ANALYSIS);
  for (let t = 0; t <= 3100; t += 100) analysis.update(sample(false), t);
  let status = analysis.update(sample(true), 3200);
  for (let t = 3300; t <= 7000; t += 100) status = analysis.update(sample(true), t);
  assert.equal(status.behaviors!.possiblePockets, true);
  assert.equal(status.behaviors!.fidgeting, false);
  assert.deepEqual(alerts, [{ type: 'alert', value: 'hands' }]);
  assert.equal(analysis.update(sample(false), 7100).behaviors!.possiblePockets, false);
});

test('a screenshot-like static pose with no recent entry is not labeled normal or confirmed pockets', () => {
  const entry = new FrontPocketEntry();
  for (let t = 0; t <= 3000; t += 100) entry.calibrate(sample(false), t);
  const hands = entry.update(sample(true), 7000);
  assert.equal(hands.left.possible, false); assert.equal(hands.left.state, 'uncertain');
  const analysis = new VisionAnalysis(() => {});
  const status = analysis.update(sample(true), 0);
  status.debug!.pocketHands = hands;
  assert.match(handsSummary(status), /Pocket-area pose/);
  assert.doesNotMatch(handsSummary(status), /Normal hand position/);
});

test('outer hip envelope still requires elbow support and normal hanging arms remain clear', () => {
  const entry = new FrontPocketEntry();
  for (let t = 0; t <= 3000; t += 100) entry.calibrate(sample(false), t);
  entry.update(sample(false), 3100);
  for (let t = 3200; t <= 7000; t += 100) {
    assert.equal(entry.update(sample(true, true), t).left.possible, false);
  }
  assert.equal(entry.update(sample(false), 7100).left.state, 'at_sides');
});
