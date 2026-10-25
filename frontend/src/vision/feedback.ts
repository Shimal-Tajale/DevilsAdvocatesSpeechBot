import type { AnalysisStatus } from './types.js';

export const VISION_FEEDBACK_LABELS = [
  ['slouching', 'Slouching'], ['swaying', 'Swaying'],
  ['fidgeting', 'Fidgeting'], ['possiblePockets', 'Possible hands in front pockets'],
  ['eye_contact', 'Head turned or tilted'],
] as const;

/** Present actual detector state; missing evidence must never read as good posture. */
export function detectorFeedback(status: AnalysisStatus | null, key: string, paused = false): string {
  if (paused) return 'Paused';
  if (!status) return 'Waiting for tracking';
  const detector = status.debug?.detectors[key];
  if (!detector || detector.state === 'Uncertain') return 'Tracking unavailable';
  return detector.state === 'Clear' ? 'Not detected' : detector.state;
}
