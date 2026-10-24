import { finiteLandmark, visiblePoseLandmark } from '../measurements.js';
import type { CalibrationBlocker, LandmarkFrame } from '../types.js';

export const blockerMessages: Record<CalibrationBlocker, string> = {
  neck: 'Need visible ears and shoulders with ears above shoulders',
  torso: 'Need visible shoulders and hips with hips below shoulders',
  face: 'Need finite eye/nose landmarks with sufficient eye separation',
  frame_gap: 'Frame gap exceeds calibration continuity limit; inference may be too slow',
};

export function describeFrame(frame: LandmarkFrame): string {
  const visible = frame.pose.filter(visiblePoseLandmark).length;
  const facePoints = frame.face.filter(finiteLandmark).length;
  const poseConfidence = (indices: number[]) => indices.map(index => {
    const point = frame.pose[index];
    return !finiteLandmark(point) ? 'missing'
      : `${point.visibility === undefined ? 'unset' : point.visibility.toFixed(2)}`
        + (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1 ? ' (outside frame)' : '');
  }).join(' / ');
  const lines = [
    `Video ${frame.width}×${frame.height} · time ${(frame.videoTimeMs / 1000).toFixed(2)}s`,
    `Inference ${frame.inferenceMs.toFixed(0)}ms · processed-frame gap ${frame.frameGapMs === null ? 'first frame' : `${frame.frameGapMs.toFixed(0)}ms`}`,
    `Pose: ${frame.pose.length} points, ${visible} with visibility ≥ 0.5 · Face: ${facePoints}/${frame.face.length} finite points`,
    `Pose visibility L/R · ears ${poseConfidence([7, 8])} · shoulders ${poseConfidence([11, 12])} · hips ${poseConfidence([23, 24])}`,
  ];
  if (!frame.pose.length) lines.push('No pose returned: include your upper body and hips, and improve lighting.');
  if (!frame.face.length) lines.push('No face returned by Face Landmarker: face the camera, improve lighting, and avoid a very small face in the image.');
  else if (![1, 33, 263].every(index => finiteLandmark(frame.face[index]))) {
    lines.push('Face returned, but eye/nose coordinates are missing or non-finite.');
  } else {
    lines.push('Face coordinates received; per-point visibility is not used for face tracking.');
  }
  return lines.join('\n');
}
