import { FRONT_POCKET_RULES } from './front-pockets.js';
import type { Landmark, Measurements } from './types.js';

export const finiteLandmark = (point: Landmark | undefined): point is Landmark =>
  !!point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
  Number.isFinite(point.z);

export const visiblePoseLandmark = (point: Landmark | undefined): point is Landmark =>
  finiteLandmark(point) && (point.visibility ?? 1) >= 0.5;

const visible = (p: Landmark | undefined): p is Landmark => visiblePoseLandmark(p) &&
  p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

/** Pose indices follow MediaPipe's 33-landmark topology. */
export function measure(
  pose: readonly Landmark[] = [],
  face: readonly Landmark[] = [],
  aspectRatio = 1,
  pocketVisibility = 0.75,
): Measurements {
  const result: Measurements = {
    neckHeight: null, torsoHeight: null, bodyX: null, shoulderWidth: null,
    handsLow: null, pocketProximity: null, leftWristX: null, leftWristY: null,
    rightWristX: null, rightWristY: null, headYaw: null, headPitch: null,
  };
  const core = [11, 12, 23, 24].map(i => pose[i]);
  result.trackingVisibility = core.every(finiteLandmark) ? Math.min(...core.map(p => p.visibility ?? 1)) : null;
  const left = pose[11], right = pose[12];
  if (visible(left) && visible(right)) {
    // Scale x into the same units as normalized image y.
    const width = Math.hypot((left.x - right.x) * aspectRatio, left.y - right.y);
    const shoulderY = (left.y + right.y) / 2;
    if (width > 0.02) {
      // A screen-right shoulder axis works with either anatomical ordering and
      // mirrored input. Its perpendicular removes camera roll from body ratios.
      const sign = right.x >= left.x ? 1 : -1;
      const axisX = (right.x - left.x) * aspectRatio * sign / width;
      const axisY = (right.y - left.y) * sign / width;
      const shoulderX = (left.x + right.x) * aspectRatio / 2;
      const local = (p: Landmark) => {
        const dx = p.x * aspectRatio - shoulderX, dy = p.y - shoulderY;
        return { x: (dx * axisX + dy * axisY) / width,
          y: (-dx * axisY + dy * axisX) / width };
      };
      result.shoulderMidX = shoulderX;
      result.shoulderWidth = width;
      // Torso translation requires hips as well as shoulders.
      const ears = [pose[7], pose[8]].filter(visible);
      if (ears.length === 2) {
        result.neckHeight = -(local(ears[0]).y + local(ears[1]).y) / 2;
      }
      const hips = [pose[23], pose[24]];
      if (hips.every(visible)) {
        result.hipMidX = (hips[0].x + hips[1].x) * aspectRatio / 2;
        result.torsoOffset = (shoulderX - result.hipMidX) / width;
        result.torsoLean = Math.atan2(shoulderX - result.hipMidX,
          (hips[0].y + hips[1].y) / 2 - shoulderY) * 180 / Math.PI;
        result.torsoHeight = (local(hips[0]).y + local(hips[1]).y) / 2;
        // Stationary front camera: track the upper-body center rather than
        // shoulder motion alone (which can be an ordinary speaking gesture).
        result.bodyX = (shoulderX + (hips[0].x + hips[1].x) * aspectRatio / 2) / 2;
      }
      // Require observed, in-frame wrists; missing hands are unknown, never pockets.
      const wrists = [pose[15], pose[16]];
      const hipsForHands = [pose[23], pose[24]];
      const inFrame = (p: Landmark | undefined): p is Landmark => visible(p) &&
        p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
      result.handsLow = wrists.every(inFrame)
        ? Number(wrists.every(w => w.y > shoulderY + width * 0.65)) : null;
      // Keep each wrist observable independently; one occluded hand must not
      // discard the other hand's movement history.
      for (const [i, prefix] of ['left', 'right'].entries()) {
        if (inFrame(wrists[i])) {
          const position = local(wrists[i]);
          result[`${prefix as 'left' | 'right'}WristX`] = position.x;
          result[`${prefix as 'left' | 'right'}WristY`] = position.y;
        }
      }
      for (const [i, side] of (['left', 'right'] as const).entries()) {
        const wrist = wrists[i], elbow = pose[13 + i], shoulder = pose[11 + i];
        const handPoints = [wrist, pose[17 + i], pose[19 + i], pose[21 + i]];
        result[`${side}HandVisibility`] = handPoints.every(inFrame)
          ? Math.min(...handPoints.map(p => p.visibility ?? 1)) : null;
        result[`${side}WristVisibility`] = finiteLandmark(wrist) ? wrist.visibility ?? 1 : null;
        result[`${side}PocketRegion`] = null;
        result[`${side}FrontPocketRegion`] = null;
        result[`${side}ElbowAngle`] = null;
        result[`${side}ElbowVisibility`] = finiteLandmark(elbow) ? elbow.visibility ?? 1 : null;
        result[`${side}ElbowOutward`] = null;
        if (inFrame(elbow) && hipsForHands.every(inFrame)) {
          const e = local(elbow), hip = local(hipsForHands[i]);
          const center = (local(hipsForHands[0]).x + local(hipsForHands[1]).x) / 2;
          result[`${side}ElbowOutward`] = (e.x - hip.x) * Math.sign(hip.x - center);
          if (inFrame(wrist)) {
            const w = local(wrist), sh = local(shoulder);
            const ax = sh.x - e.x, ay = sh.y - e.y, bx = w.x - e.x, by = w.y - e.y;
            const length = Math.hypot(ax, ay) * Math.hypot(bx, by);
            if (length > 1e-6) result[`${side}ElbowAngle`] = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / length))) * 180 / Math.PI;
          }
        }
        if (!inFrame(wrist) || !hipsForHands.every(inFrame)) continue;
        const hipPositions = hipsForHands.map(local), hip = hipPositions[i], w = local(wrist);
        const hipCenter = (hipPositions[0].x + hipPositions[1].x) / 2;
        const hipSpan = Math.abs(hipPositions[0].x - hipPositions[1].x);
        const inward = (w.x - hip.x) * Math.sign(hipCenter - hip.x), above = hip.y - w.y;
        result[`${side}WristHipHorizontal`] = Math.abs(w.x - hip.x);
        result[`${side}WristHipDistance`] = Math.hypot(w.x - hip.x, w.y - hip.y);
        result[`${side}WristInward`] = inward;
        result[`${side}WristAboveHip`] = above;
        if (hipSpan >= 0.25 && (wrist.visibility ?? 1) >= pocketVisibility &&
            hipsForHands.every(p => (p.visibility ?? 1) >= pocketVisibility)) {
          // Front openings can sit just OUTSIDE skeletal hip centers, as in
          // the supplied screenshot. Temporal travel + elbow support must
          // disambiguate this wider envelope from naturally resting arms.
          result[`${side}FrontPocketRegion`] = Number((w.x - hipCenter) * (hip.x - hipCenter) > 0 &&
            inward >= -FRONT_POCKET_RULES.outwardMargin && inward <= Math.min(0.24, hipSpan * 0.4) &&
            above >= -0.12 && above <= 0.3);
          result[`${side}PocketRegion`] = Number((w.x - hipCenter) * (hip.x - hipCenter) > 0 &&
            inward >= 0.05 && inward <= Math.min(0.24, hipSpan * 0.4) && above >= -0.12 && above <= 0.3);
        }
      }
      result.pocketProximity = result.leftPocketRegion == null || result.rightPocketRegion == null
        ? null : Number(result.leftPocketRegion === 1 && result.rightPocketRegion === 1);
    }
  }

  const eyeLeft = face[33], eyeRight = face[263], nose = face[1];
  // Face models do not supply pose-style per-point visibility confidence. The JS
  // converter defaults an unset visibility to 0; rejecting it discards real faces.
  if (finiteLandmark(eyeLeft) && finiteLandmark(eyeRight) && finiteLandmark(nose)) {
    const dx = (eyeRight.x - eyeLeft.x) * aspectRatio;
    const dy = eyeRight.y - eyeLeft.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0.01) {
      const nx = (nose.x - (eyeLeft.x + eyeRight.x) / 2) * aspectRatio;
      const ny = nose.y - (eyeLeft.y + eyeRight.y) / 2;
      // Project onto the eye line and its perpendicular to reduce roll sensitivity.
      result.headYaw = (nx * dx + ny * dy) / (distance * distance);
      result.headPitch = (-nx * dy + ny * dx) / (distance * distance);
    }
  }
  return result;
}
