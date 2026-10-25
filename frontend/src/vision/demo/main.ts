import { SENSITIVE_ANALYSIS, handsSummary, postureSummary } from '../sensitivity.js';
import { initializeVision } from '../index.js';
import type { AlertValue, AnalysisStatus, VisionAlert } from '../types.js';
import { explainError } from './errors.js';
import { WebcamSession } from './session.js';
import type { CameraState } from './session.js';
import { LandmarkOverlay } from './overlay.js';
import { blockerMessages, describeFrame, describeAnalysis, drawTorsoHistory, handsObservable } from './diagnostics.js';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing demo element #${id}`);
  return value as T;
}

const video = element<HTMLVideoElement>('video');
const overlay = new LandmarkOverlay(element<HTMLCanvasElement>('landmarks'));
const diagnostics = element('diagnostics');
const analysisDiagnostics = element('analysis-diagnostics');
const torsoPlot = element<HTMLCanvasElement>('torso-history');
let lastStatusAt = 0;
const trace: unknown[] = [];
const exportTrace = element<HTMLButtonElement>('export-trace');
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
const sensitivity = element<HTMLSelectElement>('sensitivity');
const types: AlertValue[] = ['posture', 'hands', 'eye_contact'];
const labels = {
  posture: 'Posture: sustained slouching or excessive swaying',
  hands: 'Hands: possible pockets or repetitive fidgeting',
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
  sensitivity.disabled = state !== 'stopped';
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
    lastStatusAt = 0;
    analysisDiagnostics.textContent = 'Waiting for processed frames.';
    torsoPlot.getContext('2d')?.clearRect(0, 0, torsoPlot.width, torsoPlot.height);
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
  lastStatusAt = performance.now();
  if (status.debug) {
    const { torsoHistory: _history, ...debug } = status.debug;
    trace.push({ atMs: lastStatusAt, calibrated: status.calibrated, measurements: status.measurements,
      conditions: status.conditions, behaviors: status.behaviors, diagnostics: status.diagnostics, debug });
    if (trace.length > 900) trace.shift();
    exportTrace.disabled = false;
  }
  analysisDiagnostics.textContent = describeAnalysis(status);
  drawTorsoHistory(torsoPlot, status);
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
    hands: handsObservable(status),
    eye_contact: m.headYaw !== null && m.headPitch !== null,
  };
  const behaviorText = { posture: [status.behaviors?.slouching ? 'Slouching' : '', status.behaviors?.swaying ? 'Swaying' : ''].filter(Boolean).join(' · '),
    hands: [status.behaviors?.possiblePockets ? 'Possible hand in pocket' : '', status.behaviors?.fidgeting ? 'Fidgeting' : ''].filter(Boolean).join(' · '), eye_contact: 'Facing away from baseline' };
  labels.posture = behaviorText.posture || 'Posture';
  labels.hands = behaviorText.hands || 'Hands';
  for (const type of types) {
    const field = element(type);
    field.textContent = !observed[type] ? 'Not tracked'
      : !status.calibrated ? 'Calibrating'
      : status.conditions[type] ? behaviorText[type] : type === 'posture' ? postureSummary(status) : type === 'hands' ? handsSummary(status) : 'Clear';
    field.dataset.state = !observed[type] || !status.calibrated || type === 'posture' && m.torsoHeight == null ? 'unknown'
      : status.conditions[type] || type === 'hands' && Object.values(status.debug?.pocketHands ?? {}).some(h => h.possible) ? 'warning' : 'clear';
  }
  const d = status.diagnostics;
  const detail = d ? ` · neck drop ${((d.neckDrop ?? 0) * 100).toFixed(0)}% · torso drop ${((d.torsoDrop ?? 0) * 100).toFixed(0)}% · pocket still ${(d.pocketStillMs / 1000).toFixed(1)}s · reversals wrist/torso ${d.wristReversals}/${d.torsoReversals} · motion confidence ${d.motionConfidence.toFixed(2)}` : '';
  headMeasurements.textContent = m.headYaw !== null && m.headPitch !== null
    ? `Head yaw ratio ${m.headYaw.toFixed(2)} · pitch ratio ${m.headPitch.toFixed(2)} (not degrees or eye tracking)${detail}`
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
  checkAssets, initialize: options => initializeVision({ ...options, analysis: sensitivity.value === 'sensitive' ? SENSITIVE_ANALYSIS : {} }), onState: setState, onError: showError,
});

start.addEventListener('click', () => {
  errorBox.hidden = true;
  trace.length = 0; exportTrace.disabled = true;
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

// A frozen last frame must never look like a fresh Clear/Detected decision.
window.setInterval(() => {
  if (lastStatusAt && performance.now() - lastStatusAt > 1500) {
    for (const type of types) { element(type).textContent = 'Stale: no analysis frames'; element(type).dataset.state = 'unknown'; }
    analysisDiagnostics.textContent = 'STALE: no analysis frames for over 1.5 seconds.\n' + analysisDiagnostics.textContent;
    lastStatusAt = 0;
  }
}, 500);

exportTrace.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'speech-coach-vision-debug-v1',
    note: 'Local numeric diagnostics only. Generated from browser inference, not ground-truth labels.', samples: trace }, null, 2)],
    { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'vision-diagnostics.json';
  link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
});
