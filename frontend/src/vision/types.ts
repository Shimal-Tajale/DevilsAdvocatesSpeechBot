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
  /** Legacy diagnostic only; never used to classify behavior. */
  handsLow: number | null;
  pocketProximity?: number | null;
  leftWristX?: number | null;
  leftWristY?: number | null;
  rightWristX?: number | null;
  rightWristY?: number | null;
  shoulderMidX?: number | null;
  hipMidX?: number | null;
  torsoOffset?: number | null;
  torsoLean?: number | null;
  leftWristHipDistance?: number | null;
  rightWristHipDistance?: number | null;
  leftWristInward?: number | null;
  rightWristInward?: number | null;
  leftWristAboveHip?: number | null;
  rightWristAboveHip?: number | null;
  leftWristHipHorizontal?: number | null;
  rightWristHipHorizontal?: number | null;
  leftHandVisibility?: number | null;
  rightHandVisibility?: number | null;
  leftWristVisibility?: number | null;
  rightWristVisibility?: number | null;
  leftElbowVisibility?: number | null;
  rightElbowVisibility?: number | null;
  leftElbowAngle?: number | null;
  rightElbowAngle?: number | null;
  leftElbowOutward?: number | null;
  rightElbowOutward?: number | null;
  leftFrontPocketRegion?: number | null;
  rightFrontPocketRegion?: number | null;
  leftPocketRegion?: number | null;
  rightPocketRegion?: number | null;
  trackingVisibility?: number | null;
  headYaw: number | null;
  headPitch: number | null;
}

export interface AnalysisOptions {
  torsoDropAbsolute?: number;
  swayReversals?: number;
  wristExcursion?: number;
  wristReversals?: number;
  pocketVisibility?: number;
  pocketInwardTravel?: number;
  pocketBaselineSamples?: number;
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
  behaviors?: { slouching: boolean; possiblePockets: boolean; fidgeting: boolean; swaying: boolean };
  diagnostics?: { neckDrop: number | null; torsoDrop: number | null; pocketStillMs: number;
    wristReversals: number; torsoReversals: number; motionConfidence: number };
  debug?: {
    wristEvidence?: Record<'left' | 'right', import('./wrist-motion.js').WristMotionEvidence>;
    pocketHands?: Record<'left' | 'right', import('./front-pockets.js').PocketHandStatus>;
    raw: Measurements; baseline: Record<string, number> | null; thresholds: Record<string, number>;
    frameGapMs: number; historyMs: number; historySamples: number; historyReset: string;
    motionChannels: { axis: string; amplitude: number; reversals: number; reason: string }[];
    swayAmplitude: number; relativeSwayAmplitude: number; wristAmplitude: number;
    detectors: Record<string, { state: 'Clear' | 'Detected' | 'Uncertain' | 'Calibrating'; reason: string; activeMs: number }>;
    cooldownRemainingMs: Record<AlertValue, number>;
    torsoHistory: { time: number; translation: number; relative: number | null }[];
  };
}

export type CalibrationBlocker = 'neck' | 'torso' | 'face' | 'frame_gap' | 'unstable';

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
