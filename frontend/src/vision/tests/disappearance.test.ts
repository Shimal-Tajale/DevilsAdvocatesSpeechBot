import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrontPocketEntry } from '../front-pockets.js';
import { VisionAnalysis } from '../analysis.js';
import type { Measurements, VisionAlert } from '../types.js';

const sides: Measurements = { neckHeight: .5, torsoHeight: 1.5, shoulderWidth: .2,
  bodyX: .5, handsLow: 1, headYaw: 0, headPitch: .5, trackingVisibility: .95,
  leftWristX: -.5, rightWristX: .5, leftWristY: 1.7, rightWristY: 1.7,
  leftWristInward: -.2, rightWristInward: -.2, leftWristAboveHip: -.2, rightWristAboveHip: -.2,
  leftWristHipDistance: .3, rightWristHipDistance: .3, leftWristVisibility: .95, rightWristVisibility: .95,
  leftElbowVisibility: .95, rightElbowVisibility: .95, leftElbowOutward: .2, rightElbowOutward: .2,
  leftElbowAngle: 175, rightElbowAngle: 175, leftPocketRegion: 0, rightPocketRegion: 0 };
const hidden: Measurements = { ...sides, handsLow: null, leftWristX: null, rightWristX: null,
  leftWristY: null, rightWristY: null, leftWristVisibility: .1, rightWristVisibility: .1,
  leftWristInward: null, rightWristInward: null, leftPocketRegion: null, rightPocketRegion: null,
  leftElbowAngle: null, rightElbowAngle: null, leftElbowOutward: .3, rightElbowOutward: .3 };
function setup() {
  const entry = new FrontPocketEntry();
  for (let t = 0; t <= 3000; t += 100) entry.calibrate(sides, t);
  entry.update(sides, 3100);
  return entry;
}

test('near-hip disappearance plus new sustained elbow motion can establish bounded possible entry', () => {
  const entry = setup();
  assert.equal(entry.update(hidden, 3200).left.state, 'approaching');
  assert.equal(entry.update(hidden, 3400).left.possible, false);
  assert.equal(entry.update(hidden, 3500).left.state, 'occluded');
  const held = entry.update(hidden, 4300);
  assert.equal(held.left.possible, true); assert.equal(held.right.possible, true);
  assert.equal(held.left.evidenceSource, 'disappearance');
  assert.equal(entry.update(hidden, 7200).left.possible, false);
  assert.equal(entry.update(hidden, 7300).left.possible, false);
});

test('arbitrary disappearance without changed elbow support never becomes pockets', () => {
  const entry = setup();
  for (let t = 3200; t < 8000; t += 100) {
    const status = entry.update({ ...hidden, leftElbowOutward: .2, rightElbowOutward: .2 }, t);
    assert.equal(status.left.possible, false); assert.equal(status.right.possible, false);
  }
});

test('hands last visible away from hips, stale observations, low elbow visibility and pauses are excluded', () => {
  for (const kind of ['far', 'stale', 'elbow', 'pause', 'outside_frame']) {
    const entry = setup();
    if (kind === 'far') entry.update({ ...sides, leftWristHipDistance: .9, rightWristHipDistance: .9 }, 3150);
    if (kind === 'pause') entry.interrupt();
    const from = kind === 'stale' ? 4000 : 3200;
    for (let t = from; t <= from + 1300; t += 100) {
      const raw = kind === 'elbow' ? { ...hidden, leftElbowVisibility: .1, rightElbowVisibility: .1 }
        : kind === 'outside_frame' ? { ...hidden, leftWristVisibility: .95, rightWristVisibility: .95 } : hidden;
      assert.equal(entry.update(raw, t).left.possible, false, kind);
    }
  }
});

test('brief elbow changes cannot trigger and visible return clears disappearance evidence immediately', () => {
  const entry = setup(); entry.update(hidden, 3200);
  assert.equal(entry.update({ ...hidden, leftElbowOutward: .2 }, 3300).left.possible, false);
  const other = setup();
  for (let t = 3200; t <= 4300; t += 100) other.update(hidden, t);
  assert.equal(other.update(sides, 4400).left.state, 'at_sides');
  assert.equal(other.update({ ...hidden, leftElbowOutward: .2 }, 4500).left.possible, false);
});

test('disappearance path preserves sustained alert timing and does not produce fidgets', () => {
  const alerts: VisionAlert[] = []; const analysis = new VisionAnalysis(e => alerts.push(e));
  for (let t = 0; t <= 3100; t += 100) analysis.update(sides, t);
  for (let t = 3200; t <= 6100; t += 100) {
    const status = analysis.update(hidden, t);
    assert.equal(status.behaviors!.fidgeting, false);
    assert.equal(alerts.length, 0);
  }
  analysis.update(hidden, 6200);
  assert.deepEqual(alerts, [{ type: 'alert', value: 'hands' }]);
});
