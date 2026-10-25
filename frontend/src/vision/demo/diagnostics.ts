import { finiteLandmark, visiblePoseLandmark } from '../measurements.js';
import type { AnalysisStatus, CalibrationBlocker, LandmarkFrame } from '../types.js';

export const blockerMessages: Record<CalibrationBlocker, string> = {
  unstable: 'Torso geometry changing: hold still and upright; calibration restarts',
  neck: 'Need visible ears and shoulders with ears above shoulders',
  torso: 'Need visible shoulders and hips with hips below shoulders',
  face: 'Need finite eye/nose landmarks with sufficient eye separation',
  frame_gap: 'Frame gap exceeds calibration continuity limit; inference may be too slow',
};

export function describeFrame(frame: LandmarkFrame): string {
  const visible = frame.pose.filter(visiblePoseLandmark).length;
  const facePoints = frame.face.filter(finiteLandmark).length;
  const poseConfidence = (indices: number[]) => indices.map(index => {
    const point = frame.pose[index];
    return !finiteLandmark(point) ? 'missing'
      : `${point.visibility === undefined ? 'unset' : point.visibility.toFixed(2)}`
        + (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1 ? ' (outside frame)' : '');
  }).join(' / ');
  const lines = [
    `Video ${frame.width}×${frame.height} · time ${(frame.videoTimeMs / 1000).toFixed(2)}s`,
    `Inference ${frame.inferenceMs.toFixed(0)}ms · processed-frame gap ${frame.frameGapMs === null ? 'first frame' : `${frame.frameGapMs.toFixed(0)}ms`}`,
    `Pose: ${frame.pose.length} points, ${visible} with visibility ≥ 0.5 · Face: ${facePoints}/${frame.face.length} finite points`,
    `Wrist visibility L/R ${poseConfidence([15, 16])} · elbows ${poseConfidence([13, 14])}`,
    `Pose visibility L/R · ears ${poseConfidence([7, 8])} · shoulders ${poseConfidence([11, 12])} · hips ${poseConfidence([23, 24])}`,
  ];
  if (!frame.pose.length) lines.push('No pose returned: include your upper body and hips, and improve lighting.');
  if (!frame.face.length) lines.push('No face returned by Face Landmarker: face the camera, improve lighting, and avoid a very small face in the image.');
  else if (![1, 33, 263].every(index => finiteLandmark(frame.face[index]))) {
    lines.push('Face returned, but eye/nose coordinates are missing or non-finite.');
  } else {
    lines.push('Face coordinates received; per-point visibility is not used for face tracking.');
  }
  return lines.join('\n');
}


const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? 'unknown' : value.toFixed(3);

/** Pure formatter, shared by the live panel and diagnostic regression tests. */
export function describeAnalysis(status: AnalysisStatus): string {
  const d = status.debug;
  if (!d) return 'Detailed analysis unavailable';
  const lines = [
    'Coordinates: unmirrored inference image; x right, y down; preview mirrored by CSS only.',
    'X midpoints: aspect-corrected image units. Offsets/distances: shoulder widths. Lean: degrees.',
    'Visibility is landmark visibility, not detector accuracy or an overall model confidence.',
    `Analysis gap ${d.frameGapMs.toFixed(0)}ms · history ${d.historySamples} frames / ${d.historyMs.toFixed(0)}ms · reset: ${d.historyReset}`,
    '', 'Measurement                         raw → smoothed',
  ];
  const labels = {
    trackingVisibility: 'Core minimum visibility', shoulderMidX: 'Shoulder midpoint X', hipMidX: 'Hip midpoint X',
    torsoOffset: 'Shoulder-to-hip horizontal offset', torsoLean: 'Torso lean angle (frontal)',
    bodyX: 'Torso center X', shoulderWidth: 'Shoulder width', torsoHeight: 'Torso height / shoulder width',
    neckHeight: 'Head-to-shoulder vertical distance', leftWristX: 'Left wrist torso-relative X', leftWristY: 'Left wrist torso-relative Y',
    rightWristX: 'Right wrist torso-relative X', rightWristY: 'Right wrist torso-relative Y',
    leftWristHipDistance: 'Left wrist-to-hip distance', rightWristHipDistance: 'Right wrist-to-hip distance',
    leftWristHipHorizontal: 'Left wrist-hip horizontal distance', rightWristHipHorizontal: 'Right wrist-hip horizontal distance',
    leftHandVisibility: 'Left wrist + hand-tip visibility', rightHandVisibility: 'Right wrist + hand-tip visibility',
    leftWristVisibility: 'Left wrist visibility', rightWristVisibility: 'Right wrist visibility',
    leftElbowVisibility: 'Left elbow visibility', rightElbowVisibility: 'Right elbow visibility',
    leftElbowAngle: 'Left elbow angle (2D degrees)', rightElbowAngle: 'Right elbow angle (2D degrees)',
    leftElbowOutward: 'Left elbow outward offset', rightElbowOutward: 'Right elbow outward offset',
    leftFrontPocketRegion: 'Left front-pocket opening envelope', rightFrontPocketRegion: 'Right front-pocket opening envelope',
    leftWristInward: 'Left wrist inward offset', rightWristInward: 'Right wrist inward offset',
    leftWristAboveHip: 'Left wrist above hip', rightWristAboveHip: 'Right wrist above hip', pocketProximity: 'Both wrists in pocket region',
  } as const;
  for (const key of Object.keys(labels) as (keyof typeof labels)[]) {
    lines.push(`${labels[key].padEnd(37)} ${number(d.raw[key])} → ${number(status.measurements[key])}`);
  }
  lines.push('', `Sway translation range ${number(d.swayAmplitude)} · relative range ${number(d.relativeSwayAmplitude)} · reversals ${status.diagnostics?.torsoReversals ?? 0}`,
    `Wrist range ${number(d.wristAmplitude)} · reversals ${status.diagnostics?.wristReversals ?? 0}`,
    '', 'DETECTOR DECISIONS (live candidates; emitted alerts have a separate delay)');
  for (const [name, detector] of Object.entries(d.detectors)) {
    lines.push(`${name}: ${detector.state} · active ${(detector.activeMs / 1000).toFixed(1)}s`, `  ${detector.reason}`);
  }
  for (const channel of d.motionChannels) lines.push(`  ${channel.axis}: range ${number(channel.amplitude)}, reversals ${channel.reversals}; ${channel.reason}`);
  if (d.wristEvidence) for (const [side, evidence] of Object.entries(d.wristEvidence)) lines.push(`  ${side} wrist motion ${evidence.eligible ? 'eligible' : 'excluded'}: ${evidence.reason}`);
  if (d.pocketHands) {
    lines.push('', 'FRONT POCKET ENTRY (each hand; confidence is heuristic evidence, not probability)');
    for (const [side, hand] of Object.entries(d.pocketHands)) lines.push(
      `${side}: ${hand.state} · source ${hand.evidenceSource} · confidence ${number(hand.confidence)} · possible ${hand.possible}`,
      `  baseline inward ${number(hand.baselineInward)} (${hand.baselineSamples} samples) · elbow baseline ${number(hand.baselineElbowAngle)}°`,
      `  elbow outward baseline ${number(hand.baselineElbowOutward)} · baseline noise ${number(hand.baselineNoise)} · required travel ${number(hand.requiredInwardTravel)} (max of safety floor and 4× observed calibration noise)`,
      `  inward travel ${number(hand.inwardTravel)} · elbow support ${hand.elbowSupport} · active ${hand.activeMs}ms · occluded ${hand.occlusionAgeMs}ms`,
      `  ${hand.reason}`);
  }
  lines.push('', 'Alert category cooldown remaining (does not suppress live candidates):');
  for (const [key, ms] of Object.entries(d.cooldownRemainingMs)) lines.push(`  ${key}: ${(ms / 1000).toFixed(1)}s`);
  lines.push('', 'CALIBRATION BASELINE (hold upright; stable bad posture cannot be identified automatically)',
    JSON.stringify(d.baseline, null, 2), '', 'ACTIVE THRESHOLDS', JSON.stringify(d.thresholds, null, 2));
  return lines.join('\n');
}

export function drawTorsoHistory(canvas: HTMLCanvasElement, status: AnalysisStatus): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const width = canvas.width, height = canvas.height;
  context.clearRect(0, 0, width, height);
  const points = status.debug?.torsoHistory ?? [];
  if (points.length < 2) return;
  const first = points[0].time, span = Math.max(1, points.at(-1)!.time - first);
  const origin = points[0].translation;
  const scale = Math.max(0.5, ...points.flatMap(p => [Math.abs(p.translation - origin), Math.abs(p.relative ?? 0)]));
  context.strokeStyle = '#334954'; context.beginPath(); context.moveTo(0, height / 2); context.lineTo(width, height / 2); context.stroke();
  for (const relative of [false, true]) {
    context.strokeStyle = relative ? '#ffd183' : '#9ae9c6'; context.beginPath();
    let pen = false;
    for (const p of points) {
      const value = relative ? p.relative : p.translation - origin;
      if (value == null) { pen = false; continue; }
      const x = (p.time - first) / span * width, y = height / 2 - value / scale * (height / 2 - 8);
      if (pen) context.lineTo(x, y); else context.moveTo(x, y);
      pen = true;
    }
    context.stroke();
  }
}


/** A supported temporal pocket candidate remains displayable during brief occlusion. */
export function handsObservable(status: AnalysisStatus): boolean {
  return status.behaviors?.possiblePockets === true || Object.values(status.debug?.pocketHands ?? {}).some(h => h.possible) || status.measurements.leftWristX != null ||
    status.measurements.rightWristX != null || status.measurements.handsLow != null;
}
