import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VisionAnalysis } from '../analysis.js';
import { SENSITIVE_ANALYSIS } from '../sensitivity.js';
import type { Measurements, VisionAlert } from '../types.js';

const upright: Measurements = { neckHeight: .5, torsoHeight: 1.5, shoulderWidth: .2,
  bodyX: .5, handsLow: 0, headYaw: 0, headPitch: .5 };
function setup() {
  const alerts: VisionAlert[] = [];
  const analysis = new VisionAnalysis(e => alerts.push(e), { ...SENSITIVE_ANALYSIS, smoothingMs: 1 });
  for (let t = 0; t <= 3000; t += 100) analysis.update(upright, t);
  return { analysis, alerts };
}

test('slouch boundary jitter no longer flickers or continually resets sustained timing', () => {
  const { analysis, alerts } = setup();
  for (let t = 3100; t <= 6000; t += 100) {
    const status = analysis.update({ ...upright, torsoHeight: t % 200 ? 1.40 : 1.42 }, t);
    assert.equal(status.behaviors!.slouching, true, `candidate flickered at ${t}`);
  }
  assert.deepEqual(alerts, [{ type: 'alert', value: 'posture' }]);
  const recovered = analysis.update({ ...upright, torsoHeight: 1.48 }, 6100);
  assert.equal(recovered.behaviors!.slouching, false);
  assert.equal(recovered.debug!.detectors.slouching.state, 'Clear');
  assert.ok(recovered.debug!.thresholds.slouchRecoveryDropFraction < recovered.debug!.thresholds.torsoDropFraction);
});

test('recovery band cannot initiate slouch without crossing the entry threshold', () => {
  const { analysis, alerts } = setup();
  for (let t = 3100; t <= 7000; t += 100) {
    const status = analysis.update({ ...upright, torsoHeight: 1.42, neckHeight: .1 }, t);
    assert.equal(status.behaviors!.slouching, false);
  }
  assert.equal(alerts.length, 0);
});

test('missing torso, pauses and recalibration clear the retained slouch state', () => {
  for (const kind of ['missing', 'pause', 'reset']) {
    const { analysis } = setup();
    assert.equal(analysis.update({ ...upright, torsoHeight: 1.4 }, 3100).behaviors!.slouching, true);
    if (kind === 'missing') analysis.update({ ...upright, torsoHeight: null }, 3200);
    if (kind === 'pause') analysis.interrupt();
    if (kind === 'reset') analysis.reset();
    assert.equal(analysis.update({ ...upright, torsoHeight: 1.42 }, 3300).behaviors!.slouching, false);
  }
});
