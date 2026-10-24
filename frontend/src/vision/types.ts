export type AlertValue = 'posture' | 'hands' | 'eye_contact';

export interface VisionAlert {
  type: 'alert';
  value: AlertValue;
}

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

/** Null means unobservable, not a positive or negative detection. */
export interface Measurements {
  neckHeight: number | null;
  torsoHeight: number | null;
  bodyX: number | null;
  shoulderWidth: number | null;
  handsLow: number | null;
  headYaw: number | null;
  headPitch: number | null;
}

export interface AnalysisOptions {
  calibrationMs: number;
  sustainedMs: number;
  cooldownMs: number;
  smoothingMs: number;
  maxFrameGapMs: number;
  swayWindowMs: number;
  /** Fractions of the calibrated heights. */
  neckDropFraction: number;
  torsoDropFraction: number;
  /** Horizontal travel in shoulder widths within the rolling sway window. */
  swayThreshold: number;
  /** Landmark ratios, not degrees or actual gaze estimates. */
  yawThreshold: number;
  pitchThreshold: number;
}

export interface AnalysisStatus {
  calibrated: boolean;
  calibrationProgress: number;
  measurements: Measurements;
  conditions: Record<AlertValue, boolean>;
  calibrationBlockers: CalibrationBlocker[];
}

export type CalibrationBlocker = 'neck' | 'torso' | 'face' | 'frame_gap';

/** Normalized, unmirrored landmarks from the same inference used for analysis.
 * Treat arrays as read-only. Called synchronously once per processed frame.
 */
export interface LandmarkFrame {
  pose: readonly Landmark[];
  face: readonly Landmark[];
  width: number;
  height: number;
  videoTimeMs: number;
  inferenceMs: number;
  frameGapMs: number | null;
}

export interface VisionOptions {
  /** Directory containing WASM files from the installed tasks-vision version. */
  wasmRoot: string;
  poseModelPath: string;
  faceModelPath: string;
  onAlert: (event: VisionAlert) => void;
  onStatus?: (status: AnalysisStatus) => void;
  onLandmarks?: (frame: LandmarkFrame) => void;
  onError?: (error: unknown) => void;
  delegate?: 'CPU' | 'GPU';
  maxFps?: number;
  analysis?: Partial<AnalysisOptions>;
}

export interface VisionController {
  start: (video: HTMLVideoElement) => void;
  stop: () => void;
  recalibrate: () => void;
  cleanup: () => void;
}
