import type { Measurements } from './types.js';

export type HandSide = 'left' | 'right';
export interface PocketHandStatus {
  state: 'uncertain' | 'at_sides' | 'approaching' | 'entered' | 'occluded';
  evidenceSource: 'none' | 'visible_entry' | 'disappearance';
  confidence: number;
  reason: string;
  baselineInward: number | null;
  baselineElbowAngle: number | null;
  baselineElbowOutward: number | null;
  baselineSamples: number;
  baselineNoise: number | null;
  requiredInwardTravel: number;
  inwardTravel: number | null;
  elbowSupport: boolean;
  activeMs: number;
  occlusionAgeMs: number;
  possible: boolean;
}

/** Inspectable initial heuristics, not thresholds fitted to webcam ground truth. */
export const FRONT_POCKET_RULES = {
  visibility: 0.75, minBaselineSamples: 5, inwardTravel: 0.08,
  minApproachMs: 200, entryWindowMs: 2500, holdMs: 1000,
  occlusionMemoryMs: 4000, occlusionOnsetMs: 450,
  elbowBendChangeDegrees: 15, elbowBentDegrees: 155, elbowOutward: 0.05,
  disappearanceSupportMs: 250, disappearanceNearHipDistance: 0.5,
  disappearanceElbowChange: 0.05,
  minConfidence: 0.7, outwardMargin: 0.18, outerAboveMin: 0.03, restVerticalTolerance: 0.15,
} as const;

type PocketRules = { [K in keyof typeof FRONT_POCKET_RULES]: number };

interface HandMemory {
  nearHipSeen: number | null; disappearanceSince: number | null;
  baselineOutward: number; outwardSamples: number;
  source: PocketHandStatus['evidenceSource'];
  baselineAbove: number; aboveSamples: number; baselineInward: number; baselineElbow: number; inwardM2: number; elbowSamples: number; samples: number;
  lastNormal: number | null; approach: number | null; entered: number | null;
  lastSeen: number | null; support: boolean; occlusionStart: number | null;
}
const memory = (): HandMemory => ({ nearHipSeen: null, disappearanceSince: null, baselineOutward: 0, outwardSamples: 0, source: 'none', baselineAbove: 0, aboveSamples: 0, baselineInward: 0, baselineElbow: 0, inwardM2: 0, elbowSamples: 0, samples: 0,
  lastNormal: null, approach: null, entered: null, lastSeen: null, support: false, occlusionStart: null });
const numeric = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Missing wrists require prior visible location and new supporting arm motion. */
export class FrontPocketEntry {
  readonly rules: Readonly<PocketRules>;
  constructor(overrides: Partial<PocketRules> = {}) {
    this.rules = { ...FRONT_POCKET_RULES, ...overrides };
    for (const [name, value] of Object.entries(this.rules)) {
      if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid pocket rule ${name}`);
    }
  }
  private hands = { left: memory(), right: memory() };
  reset(): void { this.hands = { left: memory(), right: memory() }; }
  interrupt(): void {
    for (const hand of Object.values(this.hands)) { this.clearEntry(hand); hand.nearHipSeen = null; }
  }
  private clearEntry(h: HandMemory): void {
    h.lastNormal = null; h.approach = null; h.entered = null; h.lastSeen = null;
    h.disappearanceSince = null; h.source = 'none';
    h.support = false; h.occlusionStart = null;
  }
  calibrate(raw: Measurements, time: number): void {
    for (const side of ['left', 'right'] as const) {
      const h = this.hands[side], inward = raw[`${side}WristInward`];
      const visibility = raw[`${side}WristVisibility`];
      // Learn only confidently visible, outward/side-resting wrists. A hand
      // already near the pocket must not become an upright-at-sides baseline.
      if (!numeric(inward) || !numeric(visibility) || visibility < this.rules.visibility || inward > 0.02) continue;
      h.samples++;
      const delta = inward - h.baselineInward;
      h.baselineInward += delta / h.samples;
      h.inwardM2 += delta * (inward - h.baselineInward);
      const outward = raw[`${side}ElbowOutward`];
      if (numeric(outward)) { h.outwardSamples++; h.baselineOutward += (outward - h.baselineOutward) / h.outwardSamples; }
      const above = raw[`${side}WristAboveHip`];
      if (numeric(above)) { h.aboveSamples++; h.baselineAbove += (above - h.baselineAbove) / h.aboveSamples; }
      const angle = raw[`${side}ElbowAngle`];
      if (numeric(angle)) { h.elbowSamples++; h.baselineElbow += (angle - h.baselineElbow) / h.elbowSamples; }
      h.lastNormal = time;
    }
  }
  update(raw: Measurements, time: number): Record<HandSide, PocketHandStatus> {
    return { left: this.updateHand('left', raw, time), right: this.updateHand('right', raw, time) };
  }
  private updateHand(side: HandSide, raw: Measurements, time: number): PocketHandStatus {
    const h = this.hands[side], r = this.rules;
    const inward = raw[`${side}WristInward`], angle = raw[`${side}ElbowAngle`];
    const visibility = raw[`${side}WristVisibility`];
    const regionKey = `${side}FrontPocketRegion` as const;
    const region = regionKey in raw ? raw[regionKey] : raw[`${side}PocketRegion`];
    const core = numeric(raw.trackingVisibility) && raw.trackingVisibility >= r.visibility;
    const observed = numeric(visibility) && visibility >= r.visibility && numeric(inward) && numeric(region);
    const noise = h.samples > 1 ? Math.sqrt(h.inwardM2 / (h.samples - 1)) : 0;
    const requiredTravel = Math.max(r.inwardTravel, 4 * noise);
    const travel = numeric(inward) && h.samples ? inward - h.baselineInward : null;
    const status = (state: PocketHandStatus['state'], confidence: number, reason: string): PocketHandStatus => ({
      state, confidence, reason, evidenceSource: h.source, baselineElbowOutward: h.outwardSamples ? h.baselineOutward : null, baselineInward: h.samples ? h.baselineInward : null,
      baselineElbowAngle: h.elbowSamples ? h.baselineElbow : null, baselineSamples: h.samples, baselineNoise: h.samples > 1 ? noise : null, requiredInwardTravel: requiredTravel,
      inwardTravel: travel, elbowSupport: h.support, activeMs: h.entered == null ? 0 : time - h.entered,
      occlusionAgeMs: h.occlusionStart == null ? 0 : time - h.occlusionStart,
      possible: (state === 'entered' || state === 'occluded') && h.entered != null &&
        time - h.entered >= r.holdMs && confidence >= r.minConfidence,
    });
    if (!core) { this.clearEntry(h); return status('uncertain', 0, 'Reliable shoulders/hips unavailable; temporal evidence cleared'); }
    if (h.samples < r.minBaselineSamples) return status('uncertain', 0, 'Need visible hands at sides during calibration');
    if (observed) {
      const distance = raw[`${side}WristHipDistance`], above = raw[`${side}WristAboveHip`];
      h.nearHipSeen = numeric(distance) && distance <= r.disappearanceNearHipDistance &&
        numeric(above) && above >= -0.35 && above <= 0.3 ? time : null;
      h.disappearanceSince = null;
    }
    if (!observed) {
      const visibilityLost = !numeric(visibility) || visibility < r.visibility;
      const outward = raw[`${side}ElbowOutward`];
      const supportRetained = !numeric(outward) || outward >= r.elbowOutward;
      // Fast entry can hide the wrist before the visible 200ms approach delay
      // completes. Complete that transition only with prior inward-region travel,
      // observed elbow bend, a recent normal position, and current outward elbow.
      if (visibilityLost && h.entered == null && h.approach != null && h.support &&
          h.lastSeen != null && time - h.lastSeen <= r.occlusionOnsetMs &&
          h.lastNormal != null && time - h.lastNormal <= r.entryWindowMs &&
          numeric(outward) && outward >= r.elbowOutward) {
        h.entered = h.approach; h.source = 'visible_entry';
      }
      if (visibilityLost && supportRetained && h.entered != null && h.lastSeen != null &&
          (h.occlusionStart != null || time - h.lastSeen <= r.occlusionOnsetMs) &&
          time - h.lastSeen <= r.occlusionMemoryMs && h.support) {
        h.occlusionStart ??= time;
        return status('occluded', h.source === 'disappearance' ? 0.7 : 0.75, h.source === 'disappearance'
          ? 'Previously visible hand disappeared near hip with new outward elbow support; memory expires'
          : 'Brief wrist occlusion follows observed inward entry with elbow support; memory expires');
      }
      // Fallback when the webcam misses the insertion itself: a recent visible
      // wrist near its hip + a NEW outward elbow change during disappearance.
      // Repeated missing frames alone never refresh or establish this evidence.
      const elbowVisibility = raw[`${side}ElbowVisibility`];
      const newElbowSupport = numeric(outward) && h.outwardSamples >= r.minBaselineSamples &&
        outward >= r.elbowOutward && outward - h.baselineOutward >= r.disappearanceElbowChange &&
        numeric(elbowVisibility) && elbowVisibility >= r.visibility;
      const recentHip = h.nearHipSeen != null && time - h.nearHipSeen <=
        (h.disappearanceSince == null ? r.occlusionOnsetMs : r.occlusionMemoryMs);
      if (visibilityLost && h.entered == null && recentHip && newElbowSupport) {
        h.disappearanceSince ??= time;
        h.source = 'disappearance';
        if (time - h.disappearanceSince < r.disappearanceSupportMs) {
          return status('approaching', 0.4, 'Hand disappeared near hip; waiting for sustained new outward elbow support');
        }
        h.entered = h.disappearanceSince;
        h.lastSeen = h.nearHipSeen;
        h.occlusionStart = h.disappearanceSince;
        h.support = true;
        return status('occluded', 0.7, 'Possible entry: previously visible hand disappeared near hip with sustained outward elbow change; bounded memory');
      }
      this.clearEntry(h);
      return status('uncertain', 0, 'Missing wrist without recent near-hip observation and new sustained elbow support; not pocket evidence');
    }
    h.occlusionStart = null;
    const supporting = numeric(angle) && numeric(raw[`${side}ElbowOutward`]) && raw[`${side}ElbowOutward`]! >= r.elbowOutward &&
      (angle < r.elbowBentDegrees || (h.elbowSamples > 0 && h.baselineElbow - angle >= r.elbowBendChangeDegrees));
    const outerOpening = numeric(inward) && inward < 0.05;
    const aboveHip = raw[`${side}WristAboveHip`];
    const supported = (supporting || h.support) && numeric(aboveHip) && aboveHip >= r.outerAboveMin;
    if (region !== 1 || travel == null || travel < requiredTravel || outerOpening && !supported) {
      const above = raw[`${side}WristAboveHip`];
      const nearRest = travel != null && Math.abs(travel) < requiredTravel && !supporting &&
        (!h.aboveSamples || numeric(above) && Math.abs(above - h.baselineAbove) <= r.restVerticalTolerance);
      const previousNormal = h.lastNormal;
      this.clearEntry(h);
      if (nearRest) {
        h.lastNormal = time;
        return status('at_sides', 0, 'Visible wrist matches calibrated side-resting position; pocket state cleared');
      }
      // Do not call every failed pocket candidate a normal hand position.
      // Preserve the recent normal timestamp while waiting for elbow support.
      h.lastNormal = previousNormal;
      return status('uncertain', 0.2, region === 1 && outerOpening && !supported
        ? 'Near outer front-pocket opening; need elbow support and wrist above hip as well as inward travel'
        : region === 1 ? 'Pocket-area pose, but inward travel from rest is insufficient'
        : 'Visible hand differs from rest but is outside the front-pocket envelope');
    }
    if (h.entered != null) {
      h.lastSeen = time; h.support ||= supporting;
      return status('entered', h.support ? 0.9 : 0.7, 'Observed inward entry retained while wrist remains in front-pocket region');
    }
    if (h.lastNormal == null || time - h.lastNormal > r.entryWindowMs) {
      h.approach = null;
      return status('uncertain', 0.2, 'Near hip, but no recent visible transition from normal position');
    }
    h.approach ??= time;
    h.support ||= supporting;
    h.lastSeen = time;
    if (time - h.approach >= r.minApproachMs) {
      h.entered = time; h.source = 'visible_entry';
      return status('entered', h.support ? 0.9 : 0.7, 'Inward travel from calibrated sides observed; waiting for sustained hold');
    }
    return status('approaching', 0.4, 'Inward wrist transition observed; waiting for continuous entry evidence');
  }
}
