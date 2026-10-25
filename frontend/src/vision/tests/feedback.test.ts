import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectorFeedback, VISION_FEEDBACK_LABELS } from '../feedback.js';
import type { AnalysisStatus } from '../types.js';

test('feedback covers all five live behaviors including head orientation', () => {
  assert.deepEqual(VISION_FEEDBACK_LABELS.map(([key]) => key),
    ['slouching', 'swaying', 'fidgeting', 'possiblePockets', 'eye_contact']);
});

test('feedback distinguishes detections, clear, uncertain, calibration and pause', () => {
  for (const [state, expected] of [['Detected', 'Detected'], ['Clear', 'Not detected'],
    ['Uncertain', 'Tracking unavailable'], ['Calibrating', 'Calibrating']] as const) {
    const status = { debug: { detectors: { slouching: { state } } } } as unknown as AnalysisStatus;
    assert.equal(detectorFeedback(status, 'slouching'), expected);
    assert.equal(detectorFeedback(status, 'slouching', true), 'Paused');
    assert.equal(detectorFeedback(status, 'missing'), 'Tracking unavailable');
  }
  assert.equal(detectorFeedback(null, 'slouching'), 'Waiting for tracking');
});
