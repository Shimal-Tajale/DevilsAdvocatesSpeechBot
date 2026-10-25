import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VisionAnalysis } from '../analysis.js';
import { SENSITIVE_ANALYSIS } from '../sensitivity.js';
import { measure } from '../measurements.js';
import type { AlertBehavior, AnalysisStatus, Landmark, VisionAlert } from '../types.js';

// Same generated front view as pocket-sway.test.ts: wrists at the sides, with an
// optional sideways shoulder shift (sway) and a shortened torso (slouch).
function sample(shoulderShift = 0, slouch = false) {
  const p = (x: number, y: number, visibility = .98): Landmark => ({ x, y, z: 0, visibility });
  const pose: Landmark[] = [];
  pose[11] = p(.4 + shoulderShift, .35); pose[12] = p(.6 + shoulderShift, .35);
  pose[23] = p(.43, .67); pose[24] = p(.57, .67);
  pose[7] = p(.46 + shoulderShift, .24); pose[8] = p(.54 + shoulderShift, .24);
  for (const i of [0, 1]) {
    const mirror = (x: number) => i ? 1 - x : x;
    pose[13 + i] = p(mirror(.37), .52);
    pose[15 + i] = p(mirror(.38), .73);
    for (const tip of [17, 19, 21]) pose[tip + i] = { ...pose[15 + i], y: pose[15 + i].y + .015 };
  }
  const measured = { ...measure(pose, [], 1, .55), headYaw: 0, headPitch: .5 };
  return slouch ? { ...measured, torsoHeight: measured.torsoHeight! * .6 } : measured;
}

test('each behaviour has its own cooldown: slouching alerts right after a sway alert', () => {
  const alerts: { at: number; event: VisionAlert; behavior?: AlertBehavior }[] = [];
  let status!: AnalysisStatus;
  let pending: VisionAlert[] = [];
  const analysis = new VisionAnalysis(event => pending.push(event), SENSITIVE_ANALYSIS);
  const step = (raw: ReturnType<typeof sample>, t: number) => {
    status = analysis.update(raw, t);
    for (const event of pending) alerts.push({ at: t, event, behavior: status.alertBehaviors?.[event.value] });
    pending = [];
  };
  for (let t = 0; t <= 3100; t += 100) step(sample(), t);
  assert.equal(status.calibrated, true);

  // Sway until it alerts.
  let t = 3200;
  for (; t <= 20000 && alerts.length === 0; t += 100) step(sample(.07 * Math.sin((t - 3200) * Math.PI / 700)), t);
  assert.equal(alerts.length, 1, 'sway should alert');
  assert.deepEqual(alerts[0].event, { type: 'alert', value: 'posture' });
  assert.equal(alerts[0].behavior, 'sway');
  const swayAt = alerts[0].at;

  // Stop swaying and slouch: a shared posture cooldown would block this for 12 s.
  for (; t <= swayAt + 6000; t += 100) step(sample(0, true), t);
  const slouches = alerts.filter(a => a.behavior === 'slouch');
  assert.equal(slouches.length, 1, 'slouch should alert inside the sway alert\'s cooldown');
  assert.deepEqual(slouches[0].event, { type: 'alert', value: 'posture' });
  assert.ok(slouches[0].at - swayAt < 12000);

  // The same behaviour still waits out its own cooldown.
  const slouchAt = slouches[0].at;
  for (; t < slouchAt + 12000; t += 100) step(sample(0, true), t);
  assert.equal(alerts.filter(a => a.behavior === 'slouch').length, 1, 'no repeat slouch within 12 s');
  for (; t <= slouchAt + 12100; t += 100) step(sample(0, true), t);
  assert.equal(alerts.filter(a => a.behavior === 'slouch').length, 2, 'slouch repeats after its cooldown');
});
