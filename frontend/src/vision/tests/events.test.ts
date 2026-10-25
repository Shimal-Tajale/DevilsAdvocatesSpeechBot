import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVisionEventSender } from '../events.js';
import type { VisionAlert } from '../types.js';

test('all vision alerts map exactly to existing wire payloads, without diagnostics', () => {
  const sent: VisionAlert[] = [];
  const forward = createVisionEventSender(event => sent.push(event));
  for (const value of ['posture', 'hands', 'eye_contact'] as const) {
    forward(Object.assign({ type: 'alert' as const, value }, { diagnostics: 'local' }));
  }
  assert.deepEqual(sent, ['posture', 'hands', 'eye_contact'].map(value => ({ type: 'alert', value })));
});

test('duplicates are suppressed per category until the exact detector cooldown boundary', () => {
  let time = 0;
  const sent: VisionAlert[] = [];
  const forward = createVisionEventSender(event => sent.push(event), 12000, () => time);
  forward({ type: 'alert', value: 'posture' });
  forward({ type: 'alert', value: 'posture' });
  forward({ type: 'alert', value: 'hands' });
  time = 11999;
  forward({ type: 'alert', value: 'posture' });
  assert.equal(sent.length, 2);
  time = 12000;
  forward({ type: 'alert', value: 'posture' });
  assert.equal(sent.length, 3);
});

test('disconnected sends are dropped without replay; later live detections are delivered', () => {
  let time = 0;
  let connected = false;
  const sent: VisionAlert[] = [];
  const forward = createVisionEventSender(event => {
    if (connected) sent.push(event); // existing client's OPEN-only behavior
  }, 100, () => time);
  forward({ type: 'alert', value: 'hands' });
  connected = true;
  forward({ type: 'alert', value: 'hands' });
  assert.equal(sent.length, 0);
  time = 100;
  forward({ type: 'alert', value: 'hands' });
  assert.deepEqual(sent, [{ type: 'alert', value: 'hands' }]);
});

test('transport exceptions do not escape or prevent subsequent detections', () => {
  let attempts = 0;
  const forward = createVisionEventSender(() => { attempts++; throw new Error('closed'); });
  assert.doesNotThrow(() => forward({ type: 'alert', value: 'posture' }));
  assert.doesNotThrow(() => forward({ type: 'alert', value: 'eye_contact' }));
  assert.equal(attempts, 2);
});

test('unsupported events are not forwarded', () => {
  let attempts = 0;
  const forward = createVisionEventSender(() => { attempts++; });
  forward({ type: 'alert', value: 'sway' } as unknown as VisionAlert);
  forward({ type: 'metrics', value: 'posture' } as unknown as VisionAlert);
  assert.equal(attempts, 0);
});
