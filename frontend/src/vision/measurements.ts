import type { Landmark, Measurements } from './types.js';

export const finiteLandmark = (point: Landmark | undefined): point is Landmark =>
  !!point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
  Number.isFinite(point.z);

export const visiblePoseLandmark = (point: Landmark | undefined): point is Landmark =>
  finiteLandmark(point) && (point.visibility ?? 1) >= 0.5;

const visible = visiblePoseLandmark;

/** Pose indices follow MediaPipe's 33-landmark topology. */
export function measure(
  pose: readonly Landmark[] = [],
  face: readonly Landmark[] = [],
  aspectRatio = 1,
): Measurements {
  const result: Measurements = {
    neckHeight: null, torsoHeight: null, bodyX: null, shoulderWidth: null,
    handsLow: null, headYaw: null, headPitch: null,
  };
  const left = pose[11], right = pose[12];
  if (visible(left) && visible(right)) {
    // Scale x into the same units as normalized image y.
    const width = Math.hypot((left.x - right.x) * aspectRatio, left.y - right.y);
    const shoulderY = (left.y + right.y) / 2;
    if (width > 0.02) {
      result.shoulderWidth = width;
      result.bodyX = (left.x + right.x) * aspectRatio / 2;
      const ears = [pose[7], pose[8]].filter(visible);
      if (ears.length === 2) {
        result.neckHeight = (shoulderY - (ears[0].y + ears[1].y) / 2) / width;
      }
      const hips = [pose[23], pose[24]];
      if (hips.every(visible)) {
        const hipY = (hips[0].y + hips[1].y) / 2;
        result.torsoHeight = (hipY - shoulderY) / width;
      }
      // Missing/occluded wrists count as hidden only when shoulders are tracked.
      const lowLine = shoulderY + width * 0.65;
      result.handsLow = [pose[15], pose[16]].every(
        wrist => !visible(wrist) || wrist.y > lowLine,
      ) ? 1 : 0;
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
