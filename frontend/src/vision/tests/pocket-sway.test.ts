import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VisionAnalysis } from '../analysis.js';
import { SENSITIVE_ANALYSIS, handsSummary, postureSummary } from '../sensitivity.js';
import { FrontPocketEntry } from '../front-pockets.js';
import { measure } from '../measurements.js';
import type { AnalysisStatus, Landmark, VisionAlert } from '../types.js';

// Generated front-view landmark sequences reproduce coordinate/control-flow
// failures. These do not assert accuracy on actual occluded webcam images.
function sample(mode: 'sides' | 'pocket' | 'hidden', shoulderShift = 0, handTipsVisible = true) {
  const p = (x: number, y: number, visibility = .98): Landmark => ({ x, y, z: 0, visibility });
  const pose: Landmark[] = [];
  pose[11] = p(.4 + shoulderShift, .35); pose[12] = p(.6 + shoulderShift, .35);
  pose[23] = p(.43, .67); pose[24] = p(.57, .67);
  pose[7] = p(.46 + shoulderShift, .24); pose[8] = p(.54 + shoulderShift, .24);
  for (const i of [0, 1]) {
    const mirror = (x: number) => i ? 1 - x : x;
    pose[13 + i] = p(mirror(.37), .52);
    pose[15 + i] = p(mirror(mode === 'sides' ? .38 : .448), mode === 'sides' ? .73 : .68, mode === 'hidden' ? .1 : .98);
    for (const tip of [17, 19, 21]) pose[tip + i] = { ...pose[15 + i], y: pose[15 + i].y + .015,
      visibility: handTipsVisible ? pose[15 + i].visibility : .1 };
  }
  return { ...measure(pose, [], 1, .55), headYaw: 0, headPitch: .5 };
}
function setup() {
  const alerts: VisionAlert[] = [];
  const analysis = new VisionAnalysis(e => alerts.push(e), SENSITIVE_ANALYSIS);
  let status!: AnalysisStatus;
  for (let t = 0; t <= 3100; t += 100) status = analysis.update(sample('sides'), t);
  return { analysis, alerts, status };
}

test('tracked upright baseline has a Clear slouch decision and useful upright label', () => {
  const { status } = setup();
  assert.equal(status.debug!.detectors.slouching.state, 'Clear');
  assert.match(postureSummary(status), /Upright relative to baseline/);
  assert.doesNotMatch(postureSummary(status), /uncertain/i);
});

test('fast supported inward approach can complete via immediate visibility loss, then expires', () => {
  const { analysis, alerts } = setup();
  let status = analysis.update(sample('pocket'), 3200);
  assert.equal(status.debug!.pocketHands!.left.state, 'approaching');
  status = analysis.update(sample('hidden'), 3300);
  assert.equal(status.debug!.pocketHands!.left.state, 'occluded');
  for (let t = 3400; t <= 6300; t += 100) status = analysis.update(sample('hidden'), t);
  assert.equal(status.behaviors!.possiblePockets, true);
  assert.deepEqual(alerts, [{ type: 'alert', value: 'hands' }]);
  for (let t = 6400; t <= 7400; t += 100) status = analysis.update(sample('hidden'), t);
  assert.equal(status.behaviors!.possiblePockets, false);
});

for (const mode of ['hidden', 'pocket', 'sides'] as const) test(`upper-body sway with ${mode} wrists cannot manufacture fidgeting`, () => {
  const { analysis } = setup();
  analysis.update(sample(mode === 'hidden' ? 'pocket' : mode), 3200);
  let status!: AnalysisStatus;
  for (let t = 3300; t <= 16000; t += 100) {
    status = analysis.update(sample(mode, .07 * Math.sin((t - 3300) * Math.PI / 700)), t);
    assert.equal(status.behaviors!.fidgeting, false, `fidget candidate at ${t}`);
  }
  assert.equal(status.behaviors!.swaying, true);
  if (mode !== 'sides') assert.equal(status.debug!.wristEvidence!.left.eligible, false);
});

test('high wrist visibility with low hand-tip visibility is insufficient for fidgeting', () => {
  const { analysis, alerts } = setup();
  for (let t = 3200; t <= 15000; t += 100) {
    const raw = sample('sides', 0, false);
    raw.leftWristX! += .2 * Math.sin(t * Math.PI / 400);
    raw.leftWristInward! += .2 * Math.sin(t * Math.PI / 400);
    const status = analysis.update(raw, t);
    assert.equal(status.behaviors!.fidgeting, false);
    assert.match(status.debug!.wristEvidence!.left.reason, /Hand-tip visibility/);
  }
  assert.equal(alerts.length, 0);
});

test('losing wrist confidence immediately disables an already active fidget candidate', () => {
  const { analysis } = setup();
  let status!: AnalysisStatus;
  for (let t = 3200; t <= 11000; t += 100) {
    const raw = sample('sides');
    // Keep the wrist outside pocket regions while moving vertically near the side.
    raw.leftWristAboveHip = -.3 + .15 * Math.sin(t * Math.PI / 400);
    status = analysis.update(raw, t);
  }
  assert.equal(status.behaviors!.fidgeting, true);
  status = analysis.update(sample('hidden'), 11100);
  assert.equal(status.behaviors!.fidgeting, false);
  assert.equal(status.diagnostics!.wristReversals, 0);
});

test('single-hand pocket evidence is visible in summary without emitting a both-hand alert', () => {
  const entry = new FrontPocketEntry();
  for (let t = 0; t <= 3000; t += 100) entry.calibrate(sample('sides'), t);
  entry.update(sample('sides'), 3100);
  const leftOnly = sample('pocket');
  const sides = sample('sides');
  for (const key of Object.keys(sides)) if (key.startsWith('right')) {
    (leftOnly as unknown as Record<string, unknown>)[key] = (sides as unknown as Record<string, unknown>)[key];
  }
  for (let t = 3200; t <= 3500; t += 100) entry.update(leftOnly, t);
  const hands = entry.update(leftOnly, 4600);
  const { status } = setup();
  status.debug!.pocketHands = hands;
  assert.equal(handsSummary(status), 'Possible hand in pocket');
  assert.equal(hands.right.possible, false);
});
