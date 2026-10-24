import { initializeVision } from '../index.js';
import type { AlertValue, AnalysisStatus, VisionAlert } from '../types.js';
import { explainError } from './errors.js';
import { WebcamSession } from './session.js';
import type { CameraState } from './session.js';
import { LandmarkOverlay } from './overlay.js';
import { blockerMessages, describeFrame } from './diagnostics.js';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing demo element #${id}`);
  return value as T;
}

const video = element<HTMLVideoElement>('video');
const overlay = new LandmarkOverlay(element<HTMLCanvasElement>('landmarks'));
const diagnostics = element('diagnostics');
const calibrationBlockers = element('calibration-blockers');
const start = element<HTMLButtonElement>('start');
const stop = element<HTMLButtonElement>('stop');
const recalibrate = element<HTMLButtonElement>('recalibrate');
const cameraStatus = element('camera-status');
const calibrationStatus = element('calibration-status');
const calibration = element<HTMLProgressElement>('calibration');
const errorBox = element('error');
const alerts = element<HTMLOListElement>('alerts');
const headMeasurements = element('head-measurements');
const types: AlertValue[] = ['posture', 'hands', 'eye_contact'];
const labels = {
  posture: 'Posture: sustained slouching or excessive swaying',
  hands: 'Hands: both hands hidden or low',
  eye_contact: 'Head orientation: facing away from baseline',
};
const base = new URL('./', window.location.href);
const wasmRoot = new URL('../node_modules/@mediapipe/tasks-vision/wasm', base).href;
const poseModelPath = new URL('assets/pose_landmarker_lite.task', base).href;
const faceModelPath = new URL('assets/face_landmarker.task', base).href;

function showError(error: unknown): void {
  console.error('Webcam demo:', error);
  errorBox.textContent = explainError(error);
  errorBox.hidden = false;
}

function setState(state: CameraState): void {
  start.disabled = state !== 'stopped';
  stop.disabled = state === 'stopped';
  recalibrate.disabled = state !== 'running';
  cameraStatus.textContent = {
    stopped: 'Camera is off', requesting: 'Waiting for camera permission…',
    loading: 'Camera is live. Checking assets and loading MediaPipe models…',
    running: 'Camera and vision processing are running',
  }[state];
  if (state !== 'running') {
    overlay.clear();
    diagnostics.textContent = 'Waiting for processed frames.';
    calibrationBlockers.textContent = 'Waiting for calibration measurements.';
    calibration.value = 0;
    calibrationStatus.textContent = state === 'stopped' ? 'Camera is off' : 'Waiting for vision processing…';
    for (const type of types) {
      element(type).textContent = state === 'stopped' ? 'Camera is off' : 'Waiting for calibration';
      element(type).dataset.state = 'unknown';
    }
    headMeasurements.textContent = 'Head orientation is a proxy, not eye tracking.';
  }
}

function updateStatus(status: AnalysisStatus): void {
  calibration.value = status.calibrationProgress;
  const m = status.measurements;
  const baselineVisible = status.calibrationBlockers.length === 0;
  calibrationBlockers.textContent = status.calibrated ? 'Baseline saved. Use Recalibrate after moving the camera.'
    : baselineVisible ? 'Usable frame · accumulating baseline time.'
    : status.calibrationBlockers.map(reason => blockerMessages[reason]).join('. ');
  calibrationStatus.textContent = status.calibrated ? 'Calibrated · monitoring posture'
    : `Calibrating ${Math.round(status.calibrationProgress * 100)}% · `
      + (baselineVisible ? 'hold upright and face the camera' : 'bring ears, shoulders, hips and face into view');
  const observed: Record<AlertValue, boolean> = {
    posture: m.neckHeight !== null || m.torsoHeight !== null || m.bodyX !== null,
    hands: m.handsLow !== null,
    eye_contact: m.headYaw !== null && m.headPitch !== null,
  };
  for (const type of types) {
    const field = element(type);
    field.textContent = !observed[type] ? 'Not tracked'
      : !status.calibrated ? 'Calibrating'
      : status.conditions[type] ? 'Condition detected' : 'Clear';
    field.dataset.state = !observed[type] || !status.calibrated ? 'unknown'
      : status.conditions[type] ? 'warning' : 'clear';
  }
  headMeasurements.textContent = m.headYaw !== null && m.headPitch !== null
    ? `Head yaw ratio ${m.headYaw.toFixed(2)} · pitch ratio ${m.headPitch.toFixed(2)} (not degrees or eye tracking)`
    : 'Face not tracked · head orientation is a proxy, not eye tracking.';
}

function addAlert(event: VisionAlert): void {
  element('no-alerts').hidden = true;
  const row = document.createElement('li');
  row.textContent = `${new Date().toLocaleTimeString()} · ${labels[event.value]}`;
  const payload = document.createElement('code');
  payload.textContent = JSON.stringify(event);
  row.append(payload);
  alerts.prepend(row);
  // Bound memory and DOM growth during long webcam sessions.
  while (alerts.children.length > 30) alerts.lastElementChild?.remove();
}

async function checkAssets(signal: AbortSignal): Promise<void> {
  const paths = [poseModelPath, faceModelPath,
    ...['vision_wasm_internal.js', 'vision_wasm_internal.wasm',
      'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']
      .map(file => `${wasmRoot}/${file}`)];
  await Promise.all(paths.map(async path => {
    const response = await fetch(path, { method: 'HEAD', cache: 'no-cache', signal });
    if (!response.ok) throw new Error(`Missing asset (HTTP ${response.status}): ${path}`);
  }));
}

const session = new WebcamSession(video, {
  wasmRoot, poseModelPath, faceModelPath,
  onAlert: addAlert, onStatus: updateStatus,
  onLandmarks: frame => {
    overlay.update(frame);
    diagnostics.textContent = describeFrame(frame);
  },
}, {
  getStream: () => navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false,
  }),
  checkAssets, initialize: initializeVision, onState: setState, onError: showError,
});

start.addEventListener('click', () => {
  errorBox.hidden = true;
  alerts.replaceChildren();
  element('no-alerts').hidden = false;
  void session.start().catch(showError);
});
stop.addEventListener('click', () => {
  try { session.stop(); } catch (error) { showError(error); }
});
recalibrate.addEventListener('click', () => {
  session.recalibrate();
  calibration.value = 0;
  calibrationStatus.textContent = 'Recalibrating · hold upright and face the camera';
  calibrationBlockers.textContent = 'Waiting for fresh calibration measurements.';
});
window.addEventListener('pagehide', () => session.stop());
setState('stopped');
if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
  start.disabled = true;
  showError(new Error('Webcam access needs a supported browser on http://localhost, '
    + 'http://127.0.0.1, or HTTPS. Open http://127.0.0.1:5173/demo/ using the documented local server.'));
}
