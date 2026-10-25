import { initializeVision } from './index.js';
import type { VisionOptions } from './index.js';
import type { EventsConnection } from '../api';
import { createVisionEventSender } from './events.js';

/** Reuse useLiveEvents().send or an already-owned EventsConnection.send. */
export function initializeEventVision(
  send: EventsConnection['send'],
  options: Omit<VisionOptions, 'wasmRoot' | 'poseModelPath' | 'faceModelPath'>,
) {
  const forward = createVisionEventSender(send, options.analysis?.cooldownMs);
  return initializeReactVision({
    ...options,
    onAlert(event) {
      forward(event);
      options.onAlert(event);
    },
  });
}

/** Vite entry point: respects the deployment base path without owning camera or UI. */
export function initializeReactVision(
  options: Omit<VisionOptions, 'wasmRoot' | 'poseModelPath' | 'faceModelPath'>,
) {
  const root = `${import.meta.env.BASE_URL}vision/`;
  return initializeVision({
    ...options,
    wasmRoot: `${root}wasm`,
    poseModelPath: `${root}pose_landmarker_lite.task`,
    faceModelPath: `${root}face_landmarker.task`,
  });
}
