import { useEffect, useRef, useState } from 'react';
import type { EventsConnection } from '../api';
import { initializeEventVision } from './react';
import { RecordingVision } from './recording.js';
import { drawLandmarks } from './demo/overlay.js';
import type { AnalysisStatus } from './types.js';
import { RECORDING_POSTURE_ANALYSIS } from './sensitivity.js';

/** The recording screen owns this session; audio recording is independent. */
export function useRecordingVision(active: boolean, recording: boolean, send: EventsConnection['send']) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<AnalysisStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAlert, setLastAlert] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const owner = useRef<RecordingVision | null>(null);
  useEffect(() => {
    if (!active || !video.current) return;
    let live = true;
    let latest: AnalysisStatus | null = null;
    let lastDisplay = -Infinity;
    let lastFrame = Date.now();
    setStatus(null);
    setError(null);
    setLastAlert(null);
    setProcessing(false);
    const monitor = setInterval(() => {
      if (Date.now() - lastFrame > 2500) setProcessing(false);
    }, 1000);
    const session = new RecordingVision(video.current, {
      getStream: () => navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false,
      }),
      initialize: (onAlert, onError) => initializeEventVision(
        event => {
          if (event.type === 'alert' &&
              (event.value === 'posture' || event.value === 'hands' || event.value === 'eye_contact')) {
            onAlert({ type: 'alert', value: event.value });
          }
        },
        {
          analysis: RECORDING_POSTURE_ANALYSIS,
          onAlert: event => {
            if (!live) return;
            const behaviors = latest?.behaviors;
            const labels = event.value === 'posture'
              ? [behaviors?.slouching && 'Slouching', behaviors?.swaying && 'Swaying']
              : event.value === 'hands'
                ? [behaviors?.fidgeting && 'Fidgeting', behaviors?.possiblePockets && 'Possible hands in front pockets']
                : ['Looking away from the camera'];
            setLastAlert(labels.filter(Boolean).join(' · ') || (event.value === 'posture' ? 'Posture alert' : 'Hand movement alert'));
          },
          onError,
          onStatus: next => {
            if (!live) return;
            latest = next;
            if (performance.now() - lastDisplay >= 150) {
              lastDisplay = performance.now();
              setStatus(next);
            }
          },
          onLandmarks: frame => {
            if (!live) return;
            lastFrame = Date.now();
            setProcessing(true);
            const surface = canvas.current;
            const context = surface?.getContext('2d');
            if (!surface || !context) return;
            const width = surface.clientWidth, height = surface.clientHeight;
            const dpr = window.devicePixelRatio || 1;
            if (surface.width !== Math.round(width * dpr)) surface.width = Math.round(width * dpr);
            if (surface.height !== Math.round(height * dpr)) surface.height = Math.round(height * dpr);
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            drawLandmarks(context, frame, width, height);
          },
        },
      ),
      onAlert: send,
      onError: error => {
        if (!live) return;
        setProcessing(false);
        setError('Camera or vision unavailable. Speech recording can continue. Check camera permissions and model loading.');
        console.warn('Vision unavailable; speech recording continues.', error);
      },
    });
    owner.current = session;
    void session.start();
    return () => {
      live = false;
      clearInterval(monitor);
      session.stop();
      const surface = canvas.current;
      surface?.getContext('2d')?.clearRect(0, 0, surface.width, surface.height);
      if (owner.current === session) owner.current = null;
    };
  }, [active, send]);
  useEffect(() => { owner.current?.setRecording(recording); }, [recording]);
  return { video, canvas, status, error, lastAlert, processing };
}
