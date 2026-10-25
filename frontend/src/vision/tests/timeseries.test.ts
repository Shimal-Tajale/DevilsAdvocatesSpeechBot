import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VisionAnalysis } from '../analysis.js';
import { measure } from '../measurements.js';
import type { AnalysisStatus, Landmark, VisionAlert } from '../types.js';

// Generated landmark sequences exercise the full numerical path, including
// irregular capture intervals and measurement jitter. These are NOT webcam data.
function landmarks(t: number, mode: string): { pose: Landmark[]; face: Landmark[] } {
  const pose: Landmark[] = [];
  const point = (x: number, y: number): Landmark => ({ x, y, z: 0, visibility: 0.96 });
  pose[11] = point(0.4, 0.35); pose[12] = point(0.6, 0.35);
  pose[23] = point(0.43, 0.67); pose[24] = point(0.57, 0.67);
  pose[7] = point(0.46, 0.24); pose[8] = point(0.54, 0.24);
  pose[15] = point(0.38, 0.73); pose[16] = point(0.62, 0.73);
  const wave = Math.sin(t * Math.PI * 2 / 1400);
  if (mode === 'relative-sway') for (const i of [7, 8, 11, 12]) pose[i].x += 0.075 * wave;
  if (mode === 'translation') for (const p of pose.filter(Boolean)) p.x += 0.075 * wave;
  if (mode === 'fidget' || mode === 'one-wrist-fidget') pose[15].x += 0.045 * Math.sin(t * Math.PI * 2 / 650);
  if (mode === 'one-wrist-fidget') pose[16].visibility = 0.1;
  if (mode === 'adjustment' && t < 1300) pose[15].x += 0.045 * Math.sin(t * Math.PI * 2 / 650);
  if (mode === 'look-down') { pose[7].y += 0.075; pose[8].y += 0.075; }
  if (mode === 'compress') { pose[11].y += 0.06; pose[12].y += 0.06; }
  if (mode === 'pockets') { pose[15] = point(0.448, 0.68); pose[16] = point(0.552, 0.68); }
  for (const [i, p] of pose.entries()) if (p) {
    p.x += 0.0005 * Math.sin(t / 71 + i); p.y += 0.0005 * Math.cos(t / 93 + i);
  }
  for (const i of [0, 1]) for (const tip of [17, 19, 21]) {
    const wrist = pose[15 + i];
    pose[tip + i] = { ...wrist, y: wrist.y + .015 };
  }
  const face: Landmark[] = [];
  face[33] = point(0.46, 0.23); face[263] = point(0.54, 0.23); face[1] = point(0.5, mode === 'look-down' ? 0.29 : 0.27);
  return { pose, face };
}
function run(mode: string) {
  const alerts: VisionAlert[] = [];
  const analysis = new VisionAnalysis(e => alerts.push(e));
  let status!: AnalysisStatus;
  let time = 0, frame = 0;
  while (time < 17000) {
    const { pose, face } = landmarks(time - 4000, time <= 4000 ? 'upright' : mode);
    status = analysis.update(measure(pose, face), time);
    time += [67, 83, 100][frame++ % 3];
  }
  return { status, alerts };
}

test('looking down changes neck and head metrics without generating slouch alerts', () => {
  const { status, alerts } = run('look-down');
  assert.ok(status.diagnostics!.neckDrop! > 0.5);
  assert.equal(status.behaviors!.slouching, false);
  assert.equal(status.debug!.detectors.slouching.state, 'Clear');
  assert.ok(alerts.every(e => e.value !== 'posture'));
});

test('torso compression provides observable posture evidence independently of head', () => {
  const { status, alerts } = run('compress');
  assert.equal(status.behaviors!.slouching, true);
  assert.ok(alerts.some(e => e.value === 'posture'));
});

for (const mode of ['relative-sway', 'translation']) test(`${mode}: continuous irregular frames retain history and reversals`, () => {
  const { status, alerts } = run(mode);
  assert.ok(status.debug!.historyMs >= 5800);
  assert.ok(status.debug!.historySamples > 60);
  assert.equal(status.behaviors!.swaying, true);
  assert.ok(alerts.some(e => e.value === 'posture'));
});

test('small repeated wrist motion survives default smoothing; brief adjustment does not alert', () => {
  const { status, alerts } = run('fidget');
  assert.equal(status.behaviors!.fidgeting, true);
  assert.ok(status.diagnostics!.wristReversals >= 10);
  assert.ok(alerts.some(e => e.value === 'hands'));
  assert.equal(run('adjustment').alerts.length, 0);
});

test('inward wrists near hip height generate possible-pocket evidence; relaxed sides do not', () => {
  const { status, alerts } = run('pockets');
  assert.equal(status.behaviors!.possiblePockets, true);
  assert.ok(alerts.some(e => e.value === 'hands'));
  assert.equal(run('upright').alerts.length, 0);
});

test('movement during calibration restarts the baseline window', () => {
  const analysis = new VisionAnalysis(() => {});
  for (let t = 0; t <= 1500; t += 100) {
    const { pose, face } = landmarks(t, 'upright'); analysis.update(measure(pose, face), t);
  }
  const { pose, face } = landmarks(1600, 'compress');
  const status = analysis.update(measure(pose, face), 1600);
  assert.equal(status.calibrated, false);
  assert.equal(status.calibrationProgress, 0);
  assert.ok(status.calibrationBlockers.includes('unstable'));
});


test('one occluded wrist does not erase the other wrist history or invent pockets', () => {
  const { status, alerts } = run('one-wrist-fidget');
  assert.equal(status.behaviors!.fidgeting, true);
  assert.equal(status.behaviors!.possiblePockets, false);
  assert.equal(status.debug!.detectors.possiblePockets.state, 'Uncertain');
  assert.ok(status.debug!.motionChannels.filter(c => c.axis.startsWith('right')).every(c => c.reason.includes('Missing')));
  assert.ok(alerts.some(e => e.value === 'hands'));
});
