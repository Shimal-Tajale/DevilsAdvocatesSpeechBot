import type { Measurements } from './types.js';
import type { HandSide, PocketHandStatus } from './front-pockets.js';

/** Separate from the relaxed pocket visibility gate: inferred hidden wrists must
 * never become motion evidence simply because sensitive mode is selected. */
export const FIDGET_WRIST_VISIBILITY = 0.8;

export interface WristMotionEvidence {
  eligible: boolean;
  reason: string;
  coordinates: [number, number] | null;
}

export function wristMotionEvidence(
  raw: Measurements, smoothed: Measurements, side: HandSide, pocket?: PocketHandStatus,
): WristMotionEvidence {
  const reject = (reason: string): WristMotionEvidence => ({ eligible: false, reason, coordinates: null });
  const visibility = raw[`${side}WristVisibility`];
  if (visibility == null || !Number.isFinite(visibility) || visibility < FIDGET_WRIST_VISIBILITY) {
    return reject('Wrist visibility below fidget gate or unavailable; estimated hidden-wrist motion excluded');
  }
  const handKey = `${side}HandVisibility` as const;
  if (handKey in raw && (raw[handKey] == null || raw[handKey]! < FIDGET_WRIST_VISIBILITY)) {
    return reject('Hand-tip visibility insufficient or missing; pose-estimated wrist alone is not fidget evidence');
  }
  if (raw[`${side}WristX`] == null || raw[`${side}WristY`] == null) return reject('Wrist outside frame or missing');
  if (raw[`${side}PocketRegion`] === 1 || pocket && ['approaching', 'entered', 'occluded'].includes(pocket.state)) {
    return reject('Wrist at front-pocket region or pocket entry active; excluded from fidgeting');
  }
  // Hip-relative motion removes shoulders swaying over hands fixed at the hips.
  const hipX = smoothed[`${side}WristInward`], hipY = smoothed[`${side}WristAboveHip`];
  const x = hipX ?? smoothed[`${side}WristX`], y = hipY ?? smoothed[`${side}WristY`];
  if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return reject('No finite wrist-relative motion coordinates');
  return { eligible: true, coordinates: [x, y], reason: hipX != null && hipY != null
    ? 'Confidently tracked wrist outside pocket region; motion relative to hip'
    : 'Confidently tracked wrist; legacy shoulder-relative coordinates' };
}
