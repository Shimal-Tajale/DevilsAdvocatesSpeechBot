import type {
  AlertValue, AnalysisOptions, AnalysisStatus, CalibrationBlocker, Measurements, VisionAlert,
} from './types.js';

export const DEFAULT_ANALYSIS: Readonly<AnalysisOptions> = {
  calibrationMs: 3000, sustainedMs: 2000, cooldownMs: 12000,
  smoothingMs: 250, maxFrameGapMs: 500, swayWindowMs: 1500,
  neckDropFraction: 0.25, torsoDropFraction: 0.2, swayThreshold: 0.45,
  yawThreshold: 0.22, pitchThreshold: 0.18,
};

const alertTypes: AlertValue[] = ['posture', 'hands', 'eye_contact'];
const baselineKeys = ['neckHeight', 'torsoHeight', 'headYaw', 'headPitch'] as const;
type Baseline = Record<typeof baselineKeys[number], number>;

/** Pure clock-driven analysis. Timestamps are milliseconds of presented video. */
export class VisionAnalysis {
  readonly options: AnalysisOptions;
  private previousTime: number | null = null;
  private smoothed: Measurements | null = null;
  private baseline: Baseline | null = null;
  private calibrationElapsed = 0;
  private calibrationWeight = 0;
  private sums: Baseline = { neckHeight: 0, torsoHeight: 0, headYaw: 0, headPitch: 0 };
  private previousCalibrationValid = false;
  private sway: { time: number; x: number }[] = [];
  private since: Partial<Record<AlertValue, number>> = {};
  private emitted: Partial<Record<AlertValue, number>> = {};

  constructor(
    private readonly onAlert: (event: VisionAlert) => void,
    options: Partial<AnalysisOptions> = {},
  ) {
    this.options = { ...DEFAULT_ANALYSIS, ...options };
    for (const [key, value] of Object.entries(this.options)) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Analysis option ${key} must be finite and positive`);
      }
    }
  }

  reset(): void {
    this.previousTime = null;
    this.smoothed = null;
    this.baseline = null;
    this.calibrationElapsed = 0;
    this.calibrationWeight = 0;
    this.sums = { neckHeight: 0, torsoHeight: 0, headYaw: 0, headPitch: 0 };
    this.previousCalibrationValid = false;
    this.sway = [];
    this.since = {};
    this.emitted = {};
  }

  /** Preserve baseline and cooldowns, but never count a pause as sustained behavior. */
  interrupt(): void {
    this.previousTime = null;
    this.smoothed = null;
    this.previousCalibrationValid = false;
    this.sway = [];
    this.since = {};
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
      measurements[key] = current === null || !Number.isFinite(current) ? null
        : previous == null ? current : previous + alpha * (current - previous);
    }
    this.smoothed = measurements;
    const conditions = { posture: false, hands: false, eye_contact: false };
    const calibrationBlockers: CalibrationBlocker[] = [];
    if (measurements.neckHeight === null || measurements.neckHeight <= 0) calibrationBlockers.push('neck');
    if (measurements.torsoHeight === null || measurements.torsoHeight <= 0) calibrationBlockers.push('torso');
    if (measurements.headYaw === null || measurements.headPitch === null) calibrationBlockers.push('face');
    if (dt > this.options.maxFrameGapMs) calibrationBlockers.push('frame_gap');

    if (!this.baseline) {
      const valid = calibrationBlockers.length === 0;
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
      const slouch = (measurements.neckHeight !== null &&
        measurements.neckHeight < b.neckHeight * (1 - this.options.neckDropFraction)) ||
        (measurements.torsoHeight !== null &&
        measurements.torsoHeight < b.torsoHeight * (1 - this.options.torsoDropFraction));
      if (measurements.bodyX !== null && measurements.shoulderWidth !== null) {
        this.sway.push({ time, x: measurements.bodyX });
        this.sway = this.sway.filter(sample => time - sample.time <= this.options.swayWindowMs);
        const xs = this.sway.map(sample => sample.x);
        const travel = Math.max(...xs) - Math.min(...xs);
        conditions.posture = slouch || travel / measurements.shoulderWidth > this.options.swayThreshold;
      } else {
        this.sway = [];
        conditions.posture = slouch;
      }
      conditions.hands = measurements.handsLow !== null && measurements.handsLow > 0.7;
      conditions.eye_contact = measurements.headYaw !== null && measurements.headPitch !== null &&
        (Math.abs(measurements.headYaw - b.headYaw) > this.options.yawThreshold ||
         Math.abs(measurements.headPitch - b.headPitch) > this.options.pitchThreshold);

      for (const value of alertTypes) {
        if (!conditions[value]) {
          delete this.since[value];
          continue;
        }
        this.since[value] ??= time;
        if (time - this.since[value]! >= this.options.sustainedMs &&
            time - (this.emitted[value] ?? -Infinity) >= this.options.cooldownMs) {
          this.emitted[value] = time;
          this.onAlert({ type: 'alert', value });
        }
      }
    }
    return {
      calibrated: this.baseline !== null,
      calibrationProgress: Math.min(1, this.calibrationElapsed / this.options.calibrationMs),
      measurements,
      conditions,
      calibrationBlockers: this.baseline ? [] : calibrationBlockers,
    };
  }
}
