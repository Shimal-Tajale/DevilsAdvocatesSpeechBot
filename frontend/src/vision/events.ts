import { DEFAULT_ANALYSIS } from './analysis.js';
import type { AlertValue, VisionAlert } from './types.js';

/** Accept the existing client's send function; never open or retry a connection here. */
export function createVisionEventSender(
  send: (event: VisionAlert) => void,
  cooldownMs = DEFAULT_ANALYSIS.cooldownMs,
  now: () => number = () => performance.now(),
): (event: VisionAlert) => void {
  if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) {
    throw new Error('cooldownMs must be positive');
  }
  const lastAttempt: Partial<Record<AlertValue, number>> = {};
  return event => {
    // Keep local diagnostics and other callbacks off the shared event bus.
    if (event.type !== 'alert' ||
        !['posture', 'hands', 'eye_contact'].includes(event.value)) return;
    const time = now();
    const previous = lastAttempt[event.value];
    if (previous !== undefined && time - previous < cooldownMs) return;
    // Consume the interval even if offline. Reconnection must not replay stale alerts.
    lastAttempt[event.value] = time;
    try {
      send({ type: 'alert', value: event.value });
    } catch {
      // A transport failure must not escape into the MediaPipe frame loop.
    }
  };
}
