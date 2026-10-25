import type { AnalysisOptions, AnalysisStatus } from './types.js';

/** Provisional demo preset for inspecting smaller motions; not webcam-validated. */
export const SENSITIVE_ANALYSIS: Readonly<Partial<AnalysisOptions>> = {
  torsoDropFraction: 0.06, torsoDropAbsolute: 0.06,
  swayThreshold: 0.2, swayReversals: 3,
  wristExcursion: 0.1, wristReversals: 6,
  pocketVisibility: 0.55, pocketInwardTravel: 0.05, pocketBaselineSamples: 3,
};

/** Recording tuning: smaller torso compression and the demo's fidget sensitivity.
 * Provisional until checked against physical-camera traces. Visibility gates stay intact.
 */
export const RECORDING_POSTURE_ANALYSIS = {
  torsoDropFraction: 0.04,
  torsoDropAbsolute: 0.04,
  swayThreshold: SENSITIVE_ANALYSIS.swayThreshold,
  swayReversals: SENSITIVE_ANALYSIS.swayReversals,
  wristExcursion: SENSITIVE_ANALYSIS.wristExcursion,
  wristReversals: SENSITIVE_ANALYSIS.wristReversals,
} as const;

/** Describe visible normal geometry separately from missing entry calibration. */
export function handsSummary(status: AnalysisStatus): string {
  const raw = status.debug?.raw ?? status.measurements;
  const hands = status.debug?.pocketHands;
  if (hands?.left.possible || hands?.right.possible) return 'Possible hand in pocket';
  if (hands?.left.state === 'at_sides' && hands.right.state === 'at_sides') return 'Normal hand position';
  if (raw.leftFrontPocketRegion === 1 || raw.rightFrontPocketRegion === 1) return 'Pocket-area pose · checking entry evidence in diagnostics';
  if (raw.leftPocketRegion === 0 && raw.rightPocketRegion === 0) {
    return hands && (hands.left.baselineSamples === 0 || hands.right.baselineSamples === 0)
      ? 'Hands outside pocket region · pocket baseline unavailable' : 'Hands outside pocket region';
  }
  return status.debug?.detectors.possiblePockets.state === 'Uncertain' ? 'Pocket evidence uncertain · see diagnostics' : 'Clear';
}


export function postureSummary(status: AnalysisStatus): string {
  if (status.measurements.torsoHeight == null) return 'Torso not tracked';
  return status.debug?.detectors.swaying.state === 'Uncertain'
    ? 'Upright relative to baseline · measuring sway' : 'Upright relative to baseline · no sway detected';
}
