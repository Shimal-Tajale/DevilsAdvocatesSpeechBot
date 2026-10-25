import { wristMotionEvidence, FIDGET_WRIST_VISIBILITY } from './wrist-motion.js';
import { FrontPocketEntry } from './front-pockets.js';
import type {
  AlertBehavior, AlertValue, AnalysisOptions, AnalysisStatus, CalibrationBlocker, Measurements, VisionAlert,
} from './types.js';

export const DEFAULT_ANALYSIS: Readonly<Required<AnalysisOptions>> = {
  torsoDropAbsolute: 0.12, swayReversals: 6, wristExcursion: 0.18, wristReversals: 10,
  pocketVisibility: 0.75, pocketInwardTravel: 0.08, pocketBaselineSamples: 5,
  calibrationMs: 3000, sustainedMs: 2000, cooldownMs: 12000,
  smoothingMs: 250, maxFrameGapMs: 500, swayWindowMs: 6000,
  neckDropFraction: 0.15, torsoDropFraction: 0.12, swayThreshold: 0.45,
  yawThreshold: 0.22, pitchThreshold: 0.18,
};

const alertTypes: AlertValue[] = ['posture', 'hands', 'eye_contact'];
// Ordered so a frame's alerts still come out posture, hands, eye_contact.
const alertBehaviors: AlertBehavior[] = ['slouch', 'sway', 'pockets', 'fidget', 'eye_contact'];
const BEHAVIOR_CATEGORY: Record<AlertBehavior, AlertValue> = {
  slouch: 'posture', sway: 'posture', pockets: 'hands', fidget: 'hands', eye_contact: 'eye_contact',
};
const baselineKeys = ['neckHeight', 'torsoHeight', 'headYaw', 'headPitch'] as const;
type Baseline = Record<typeof baselineKeys[number], number>;

/** Pure clock-driven analysis. Timestamps are milliseconds of presented video. */
export class VisionAnalysis {
  readonly options: Required<AnalysisOptions>;
  private previousTime: number | null = null;
  private smoothed: Measurements | null = null;
  private baseline: Baseline | null = null;
  private slouchActive = false;
  private calibrationAnchor: Baseline | null = null;
  private calibrationElapsed = 0;
  private calibrationWeight = 0;
  private sums: Baseline = { neckHeight: 0, torsoHeight: 0, headYaw: 0, headPitch: 0 };
  private previousCalibrationValid = false;
  private sway: { time: number; x: number }[] = [];
  private motion: { time: number; values: number[] }[] = [];
  private pockets: FrontPocketEntry;
  private motionActive = { sway: false, fidget: false };
  private behaviorSince: Record<string, number> = {};
  // Per behaviour, not per category: swaying can alert right after a slouch alert.
  private since: Partial<Record<AlertBehavior, number>> = {};
  private emitted: Partial<Record<AlertBehavior, number>> = {};
  // A plain field, not a constructor parameter property, so the app's
  // erasableSyntaxOnly setting accepts this file.
  private readonly onAlert: (event: VisionAlert) => void;

  constructor(
    onAlert: (event: VisionAlert) => void,
    options: Partial<AnalysisOptions> = {},
  ) {
    this.onAlert = onAlert;
    this.options = { ...DEFAULT_ANALYSIS, ...options };
    this.pockets = new FrontPocketEntry({ visibility: this.options.pocketVisibility,
      inwardTravel: this.options.pocketInwardTravel, minBaselineSamples: this.options.pocketBaselineSamples });
    for (const [key, value] of Object.entries(this.options)) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Analysis option ${key} must be finite and positive`);
      }
    }
  }

  reset(): void {
    this.previousTime = null;
    this.slouchActive = false;
    this.smoothed = null;
    this.baseline = null;
    this.calibrationAnchor = null;
    this.calibrationElapsed = 0;
    this.calibrationWeight = 0;
    this.sums = { neckHeight: 0, torsoHeight: 0, headYaw: 0, headPitch: 0 };
    this.previousCalibrationValid = false;
    this.sway = [];
    this.motion = [];
    this.motionActive = { sway: false, fidget: false };
    this.pockets.reset();
    this.since = {};
    this.behaviorSince = {};
    this.emitted = {};
  }

  /** Preserve baseline and cooldowns, but never count a pause as sustained behavior. */
  interrupt(): void {
    if (!this.baseline) {
      this.calibrationElapsed = 0; this.calibrationWeight = 0; this.calibrationAnchor = null;
      this.sums = { neckHeight: 0, torsoHeight: 0, headYaw: 0, headPitch: 0 };
    }
    this.previousTime = null;
    this.slouchActive = false;
    this.smoothed = null;
    this.previousCalibrationValid = false;
    this.sway = [];
    this.motion = [];
    this.motionActive = { sway: false, fidget: false };
    this.pockets.interrupt();
    this.since = {};
    this.behaviorSince = {};
  }

  update(raw: Measurements, time: number): AnalysisStatus {
    if (!Number.isFinite(time) || time < 0) throw new Error('Invalid video timestamp');
    if (this.previousTime !== null && time < this.previousTime) this.reset();
    const dt = this.previousTime === null ? 0 : time - this.previousTime;
    if (dt > this.options.maxFrameGapMs) this.interrupt();
    const continuousDt = this.previousTime === null ? 0 : dt;
    this.previousTime = time;
    const alpha = 1 - Math.exp(-continuousDt / this.options.smoothingMs);
    const measurements = { ...raw };
    for (const key of Object.keys(raw) as (keyof Measurements)[]) {
      const current = raw[key];
      const previous = this.smoothed?.[key];
      measurements[key] = current == null || !Number.isFinite(current) ? null
        : previous == null ? current : previous + (key.includes('Wrist') ? 1 - Math.exp(-continuousDt / 60) : alpha) * (current - previous);
    }
    this.smoothed = measurements;
    const behaviors = { slouching: false, possiblePockets: false, fidgeting: false, swaying: false };
    const diagnostics = { neckDrop: null as number | null, torsoDrop: null as number | null,
      pocketStillMs: 0, wristReversals: 0, torsoReversals: 0, motionConfidence: 0 };
    const debug: NonNullable<AnalysisStatus['debug']> = {
      raw, baseline: this.baseline ? { ...this.baseline } : null,
      thresholds: { ...this.options,
        slouchRecoveryDropFraction: this.options.torsoDropFraction * 0.65,
        slouchRecoveryDropAbsolute: this.options.torsoDropAbsolute * 0.65,
        wristMaxRange: 0.85,
        wristHoldReversals: this.options.wristReversals - 1, swayHoldReversals: this.options.swayReversals - 1, reversalRecencyMs: 1500,
        pocketInwardMin: 0.05, pocketInwardMax: 0.24, pocketAboveMin: -0.12,
        pocketAboveMax: 0.3, wristSmoothingMs: 60, fidgetWristVisibility: FIDGET_WRIST_VISIBILITY, ...Object.fromEntries(Object.entries(this.pockets.rules).map(([k, v]) => [`frontPocket_${k}`, v])) },
      frameGapMs: dt, historyMs: 0, historySamples: 0,
      historyReset: dt > this.options.maxFrameGapMs ? 'Frame gap exceeded limit' : continuousDt === 0 ? 'Start/resume/reset' : 'None',
      motionChannels: [], swayAmplitude: 0, relativeSwayAmplitude: 0, wristAmplitude: 0, detectors: {},
      cooldownRemainingMs: { posture: 0, hands: 0, eye_contact: 0 }, torsoHistory: [],
    };
    const conditions = { posture: false, hands: false, eye_contact: false };
    const calibrationBlockers: CalibrationBlocker[] = [];
    if (measurements.neckHeight === null || measurements.neckHeight <= 0) calibrationBlockers.push('neck');
    if (measurements.torsoHeight === null || measurements.torsoHeight <= 0) calibrationBlockers.push('torso');
    if (measurements.headYaw === null || measurements.headPitch === null) calibrationBlockers.push('face');
    if (dt > this.options.maxFrameGapMs) calibrationBlockers.push('frame_gap');

    const pending: VisionAlert[] = [];
    const emittedBehaviors: Partial<Record<AlertValue, AlertBehavior>> = {};
    if (!this.baseline) {
      if (this.calibrationAnchor && baselineKeys.some(key => raw[key] != null &&
          Math.abs(raw[key]! - this.calibrationAnchor![key]) > (key === 'torsoHeight' ? 0.08 : 0.12))) {
        calibrationBlockers.push('unstable');
      }
      const valid = calibrationBlockers.length === 0;
      if (!valid) {
        this.calibrationElapsed = 0; this.calibrationWeight = 0; this.calibrationAnchor = null;
        this.pockets.reset();
        this.sums = { neckHeight: 0, torsoHeight: 0, headYaw: 0, headPitch: 0 };
      }
      if (valid) this.pockets.calibrate(raw, time);
      if (valid && !this.calibrationAnchor) this.calibrationAnchor = Object.fromEntries(
        baselineKeys.map(key => [key, raw[key]!])) as Baseline;
      if (valid && this.previousCalibrationValid && continuousDt > 0) {
        this.calibrationElapsed += continuousDt;
        this.calibrationWeight += continuousDt;
        for (const key of baselineKeys) this.sums[key] += measurements[key]! * continuousDt;
        if (this.calibrationElapsed >= this.options.calibrationMs) {
          this.baseline = Object.fromEntries(baselineKeys.map(
            key => [key, this.sums[key] / this.calibrationWeight],
          )) as Baseline;
        }
      }
      this.previousCalibrationValid = valid;
    } else {
      const b = this.baseline;
      diagnostics.neckDrop = measurements.neckHeight === null ? null : 1 - measurements.neckHeight / b.neckHeight;
      diagnostics.torsoDrop = measurements.torsoHeight === null ? null : 1 - measurements.torsoHeight / b.torsoHeight;
      // Head drop alone is nodding/looking down evidence, never slouch proof.
      // Absolute floors avoid amplifying tiny/noisy calibrated neck heights.
      // Hysteresis: enter at the configured compression, release only after
      // clear recovery. Jitter near one boundary must not alternate the live
      // label or repeatedly reset sustained-alert timing.
      const slouchScale = this.slouchActive ? 0.65 : 1;
      behaviors.slouching = diagnostics.torsoDrop !== null &&
        diagnostics.torsoDrop > this.options.torsoDropFraction * slouchScale &&
        b.torsoHeight - measurements.torsoHeight! > this.options.torsoDropAbsolute * slouchScale;
      this.slouchActive = behaviors.slouching;
      debug.pocketHands = this.pockets.update(raw, time);
      behaviors.possiblePockets = debug.pocketHands.left.possible && debug.pocketHands.right.possible;
      debug.wristEvidence = {
        left: wristMotionEvidence(raw, measurements, 'left', debug.pocketHands.left),
        right: wristMotionEvidence(raw, measurements, 'right', debug.pocketHands.right),
      };
      const wrists = [...(debug.wristEvidence.left.coordinates ?? [NaN, NaN]),
        ...(debug.wristEvidence.right.coordinates ?? [NaN, NaN])];
      diagnostics.pocketStillMs = Math.min(debug.pocketHands.left.activeMs, debug.pocketHands.right.activeMs);
      if (measurements.bodyX !== null && measurements.shoulderWidth !== null && measurements.shoulderWidth > 0) {
        // Integrate displacement using the current width: camera scale changes alone
        // cannot create torso motion. Wrists are relative to shoulder center.
        const last = this.sway.at(-1);
        const torso = (this.motion.at(-1)?.values[4] ?? 0) +
          (last ? (measurements.bodyX - last.x) / measurements.shoulderWidth : 0);
        this.sway = [{ time, x: measurements.bodyX }];
        this.motion.push({ time, values: [...wrists.map(v => v ?? NaN), torso, measurements.torsoOffset ?? NaN] });
        this.motion = this.motion.filter(sample => time - sample.time <= this.options.swayWindowMs);
        const span = time - this.motion[0].time;
        debug.historyMs = span;
        debug.historySamples = this.motion.length;
        const range = (axis: number) => {
          const values = this.motion.map(s => s.values[axis]).filter(Number.isFinite);
          return values.length ? Math.max(...values) - Math.min(...values) : 0;
        };
        debug.swayAmplitude = range(4);
        debug.relativeSwayAmplitude = range(5);
        debug.wristAmplitude = Math.max(...[0, 1, 2, 3].map(range));
        debug.torsoHistory = this.motion.map(s => ({ time: s.time, translation: s.values[4],
          relative: Number.isFinite(s.values[5]) ? s.values[5] : null }));
        const lastReversal: Record<number, number> = {};
        const repetitions = (axis: number, amplitude: number) => {
          let anchor = this.motion[0].values[axis], direction = 0, turns = 0;
          let low = anchor, high = anchor;
          let lastTurn = this.motion[0].time;
          for (const sample of this.motion) {
            const value = sample.values[axis];
            if (!Number.isFinite(value)) { anchor = NaN; low = NaN; high = NaN; turns = 0; direction = 0; continue; }
            if (!Number.isFinite(anchor)) { anchor = value; low = value; high = value; continue; }
            const delta = value - anchor;
            if (direction === 0) {
              low = Math.min(low, value); high = Math.max(high, value);
              if (value - low >= amplitude) { direction = 1; anchor = value; }
              else if (high - value >= amplitude) { direction = -1; anchor = value; }
            } else if (direction * delta > 0) anchor = value;
            else if (-direction * delta >= amplitude && sample.time - lastTurn >= 180) {
              turns++; direction *= -1; anchor = value; lastTurn = sample.time;
            }
          }
          if (turns > 0) lastReversal[axis] = lastTurn;
          return turns;
        };
        diagnostics.wristReversals = Math.max(...[0, 1, 2, 3].map(axis => {
          const values = this.motion.map(sample => sample.values[axis]);
          // Broad gestures and incomplete tracks are not evidence of small fidgets.
          const missing = values.some(v => !Number.isFinite(v));
          const amplitude = range(axis);
          const broad = amplitude > 0.85;
          const turns = missing || broad ? 0 : repetitions(axis, this.options.wristExcursion);
          debug.motionChannels.push({ axis: ['left wrist X', 'left wrist Y', 'right wrist X', 'right wrist Y'][axis],
            amplitude, reversals: turns,
            reason: missing ? 'Missing/occluded samples in this window' : broad ? 'Range exceeds small-fidget limit' :
              turns < this.options.wristReversals ? `Insufficient repeated excursions for entry (${this.options.wristReversals} required)` : 'Repetition evidence available' });
          return turns;
        }));
        diagnostics.torsoReversals = Math.max(repetitions(4, this.options.swayThreshold),
          repetitions(5, this.options.swayThreshold));
        diagnostics.motionConfidence = span < this.options.swayWindowMs * 5 / 6 ? 0 : Math.min(1, Math.max(
          diagnostics.wristReversals / this.options.wristReversals, diagnostics.torsoReversals / this.options.swayReversals));
        // Hysteresis prevents one reversal aging out of a rolling window from
        // resetting the entire sustained timer during otherwise continuous motion.
        const ready = span >= this.options.swayWindowMs * 5 / 6;
        behaviors.fidgeting = ready && diagnostics.wristReversals >= (this.options.wristReversals - (this.motionActive.fidget ? 1 : 0)) &&
          [0, 1, 2, 3].some(axis => time - (lastReversal[axis] ?? -Infinity) <= 1500);
        behaviors.swaying = ready && diagnostics.torsoReversals >= (this.options.swayReversals - (this.motionActive.sway ? 1 : 0)) &&
          [4, 5].some(axis => time - (lastReversal[axis] ?? -Infinity) <= 1500);
        this.motionActive = { fidget: behaviors.fidgeting, sway: behaviors.swaying };
      } else {
        this.motion = []; this.sway = []; this.motionActive = { sway: false, fidget: false };
        debug.historyReset = 'Missing torso measurements';
      }
      conditions.posture = behaviors.slouching || behaviors.swaying;
      conditions.hands = behaviors.possiblePockets || behaviors.fidgeting;
      conditions.eye_contact = measurements.headYaw !== null && measurements.headPitch !== null &&
        (Math.abs(measurements.headYaw - b.headYaw) > this.options.yawThreshold ||
         Math.abs(measurements.headPitch - b.headPitch) > this.options.pitchThreshold);

      // Each behaviour has its own sustained timer and cooldown. Events still name the
      // category (one per category per frame); status.alertBehaviors says which behaviour.
      const active: Record<AlertBehavior, boolean> = {
        slouch: behaviors.slouching, sway: behaviors.swaying,
        pockets: behaviors.possiblePockets, fidget: behaviors.fidgeting,
        eye_contact: conditions.eye_contact,
      };
      for (const behavior of alertBehaviors) {
        if (!active[behavior]) {
          delete this.since[behavior];
          continue;
        }
        this.since[behavior] ??= time;
        if (time - this.since[behavior]! >= this.options.sustainedMs &&
            time - (this.emitted[behavior] ?? -Infinity) >= this.options.cooldownMs) {
          this.emitted[behavior] = time;
          const value = BEHAVIOR_CATEGORY[behavior];
          if (!emittedBehaviors[value]) {
            emittedBehaviors[value] = behavior;
            pending.push({ type: 'alert', value });
          }
        }
      }
    }
    debug.pocketHands ??= this.pockets.update(raw, time);
    const reasons = {
      slouching: measurements.torsoHeight == null ? 'Torso unavailable; frontal slouch cannot be assessed'
        : behaviors.slouching ? 'Torso compression candidate; retained until recovery below 65% of entry thresholds. Alert timing remains separate'
        : 'Torso near calibrated upright baseline; no slouch detected. Head drop alone is excluded; frontal spinal curvature remains limited',
      swaying: measurements.bodyX == null ? 'Torso tracking missing'
        : `Window ${debug.historyMs.toFixed(0)}ms; translation/relative ranges ${debug.swayAmplitude.toFixed(3)}/${debug.relativeSwayAmplitude.toFixed(3)}; ${diagnostics.torsoReversals}/${this.options.swayReversals} reversals at ${this.options.swayThreshold} widths`,
      fidgeting: !debug.wristEvidence?.left.eligible && !debug.wristEvidence?.right.eligible ? 'No eligible visible wrists outside pocket regions; fidgeting disabled'
        : `Window ${debug.historyMs.toFixed(0)}ms; ${diagnostics.wristReversals}/${this.options.wristReversals} reversals; excursions ≥${this.options.wristExcursion}, total range ≤0.85 widths; missing samples exclude only affected wrist axes`,
      possiblePockets: debug.pocketHands
        ? `Both hands required. Left: ${debug.pocketHands.left.reason} Right: ${debug.pocketHands.right.reason}`
        : 'Pocket geometry unavailable: calibrating visible hands at sides',

    };
    for (const key of Object.keys(behaviors) as (keyof typeof behaviors)[]) {
      if (behaviors[key]) this.behaviorSince[key] ??= time;
      else delete this.behaviorSince[key];
      const unknown = key === 'slouching' ? measurements.torsoHeight == null
        : key === 'possiblePockets' ? !debug.pocketHands || Object.values(debug.pocketHands).some(h => h.state === 'uncertain')
        : key === 'fidgeting' ? (!debug.wristEvidence?.left.eligible && !debug.wristEvidence?.right.eligible) || debug.historyMs < this.options.swayWindowMs * 5 / 6
        : measurements.bodyX == null || debug.historyMs < this.options.swayWindowMs * 5 / 6;
      debug.detectors[key] = { state: !this.baseline ? 'Calibrating' : behaviors[key] ? 'Detected' : unknown ? 'Uncertain' : 'Clear',
        reason: reasons[key], activeMs: this.behaviorSince[key] == null ? 0 : time - this.behaviorSince[key] };
    }
    // Per category: time until any of its behaviours could alert again.
    for (const type of alertTypes) debug.cooldownRemainingMs[type] = Math.min(...alertBehaviors
      .filter(behavior => BEHAVIOR_CATEGORY[behavior] === type)
      .map(behavior => Math.max(0, this.options.cooldownMs - (time - (this.emitted[behavior] ?? -Infinity)))));
    debug.detectors.eye_contact = {
      state: !this.baseline ? 'Calibrating' : measurements.headYaw == null || measurements.headPitch == null ? 'Uncertain' : conditions.eye_contact ? 'Detected' : 'Clear',
      reason: 'Head yaw/pitch compared with calibrated baseline; not actual eye tracking',
      activeMs: this.since.eye_contact == null ? 0 : time - this.since.eye_contact,
    };
    debug.baseline = this.baseline ? { ...this.baseline } : null;
    for (const event of pending) this.onAlert(event);
    return {
      calibrated: this.baseline !== null,
      calibrationProgress: Math.min(1, this.calibrationElapsed / this.options.calibrationMs),
      measurements,
      behaviors, diagnostics, debug,
      conditions,
      calibrationBlockers: this.baseline ? [] : calibrationBlockers,
      alertBehaviors: emittedBehaviors,
    };
  }
}
