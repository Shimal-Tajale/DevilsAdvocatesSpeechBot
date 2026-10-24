# Speech Coach browser vision

Standalone TypeScript module; no React runtime dependency, camera acquisition, audio,
WebSocket connection, or backend dependency. All module files live in this directory.

## Setup

This directory has its own dependency manifest so setup does not edit the shared
frontend manifest. From the repository root:

```sh
cd frontend/src/vision
npm ci
npm run typecheck
npm test
```

When integrating into the frontend's dependency/build system, the frontend owner
can add `@mediapipe/tasks-vision@0.10.32` to that app's dependencies. Imports use
`.js` specifiers that TypeScript and Vite resolve to the corresponding `.ts` files.
Do not import the tests into the app.

Obtain the compatible **Pose Landmarker Lite** and **Face Landmarker** task bundles
from Google's official model guides:

- https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker#models
- https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker#models

For the example below, the frontend owner should serve these as
`/models/pose_landmarker_lite.task` and `/models/face_landmarker.task`.
Copy the **contents** of the installed `@mediapipe/tasks-vision/wasm/` directory
to a public `/mediapipe/wasm/` directory. Keep WASM assets and the npm package at
the same version. Paths are configurable; prefix them with Vite's
`import.meta.env.BASE_URL` when deploying under a subpath. Models and WASM are
loaded during initialization; missing assets, CORS failures, and unsupported
runtimes reject the initialization promise. No model binaries are bundled here.

## React example (for Abhiram to integrate)

This example uses an existing video element and callback, and never opens a camera.
The owner supplies either a webcam `srcObject` or a prerecorded `src` and starts
playback from an appropriate user interaction. Use HTTPS or localhost for webcam
permissions; use `muted` and `playsInline` where appropriate.

```tsx
import { useEffect, useRef } from 'react';
import { initializeVision } from './vision';
import type { VisionAlert, VisionController } from './vision';

export function CoachingVideo({ onAlert }: {
  onAlert: (event: VisionAlert) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const alertRef = useRef(onAlert);
  alertRef.current = onAlert;

  useEffect(() => {
    let cancelled = false;
    let controller: VisionController | undefined;
    const base = import.meta.env.BASE_URL;
    void initializeVision({
      wasmRoot: `${base}mediapipe/wasm`,
      poseModelPath: `${base}models/pose_landmarker_lite.task`,
      faceModelPath: `${base}models/face_landmarker.task`,
      onAlert: event => alertRef.current(event),
      onStatus: status => {
        // Show "stand upright, face camera" until status.calibrated.
        // status.calibrationProgress is 0..1; avoid updating React every frame.
      },
      onError: error => console.error('Vision processing failed', error),
    }).then(instance => {
      // Handles unmount and React StrictMode while models are still loading.
      if (cancelled || !videoRef.current) instance.cleanup();
      else {
        controller = instance;
        controller.start(videoRef.current);
      }
    }).catch(error => {
      if (!cancelled) console.error('Vision initialization failed', error);
    });
    return () => {
      cancelled = true;
      controller?.cleanup();
    };
  }, []);

  return <video ref={videoRef} muted playsInline controls />;
}
```

For webcam input, the frontend owner obtains a stream with
`navigator.mediaDevices.getUserMedia({ video: true, audio: false })`, assigns it to
`video.srcObject`, then calls `await video.play()`. The owner must stop the stream's
tracks on teardown. For replay, set `video.src = recordingUrl` (clear `srcObject`
first) and call `await video.play()`; manage/revoke any object URLs in the frontend.
The same controller works for either input. No changes to existing components are
made by this module.

## API and timing

- `await initializeVision(options)` loads resources and returns a controller.
- `start(video)` begins processing; every start begins fresh calibration. The video
  need not be playing yet. Use one speaker with ears, shoulders, hips, and face
  visible, upright and facing the camera for about three seconds of usable video.
- `stop()` cancels processing and removes video listeners. It keeps models loaded
  so a later `start(video)` can reuse them.
- `recalibrate()` discards baseline and alert state. Use it if the camera or speaker
  moves. Seeks and source changes automatically recalibrate.
- `cleanup()` stops processing and closes both models. It is safe to call twice;
  starting a cleaned-up controller throws. Camera tracks belong to the caller.
- `onAlert` receives only `{ type: 'alert', value: 'posture' | 'hands' | 'eye_contact' }`.
  The app can forward these events to its existing WebSocket layer.
- `onStatus` receives calibration progress, smoothed measurements, conditions, and
  `calibrationBlockers` (`neck`, `torso`, `face`, `frame_gap`). Blockers explain why
  baseline time is not accumulating and are empty once calibration completes.
- Optional `onLandmarks(frame)` receives normalized **unmirrored** pose/face points,
  intrinsic video width/height, video timestamp, inference duration, and the gap
  between processed frames. These are the existing detection results, with no extra
  inference. Treat the arrays as read-only. The webcam demo uses this callback for
  its canvas overlay and tracking diagnostics. Missing detections produce empty arrays.
- Inference errors stop processing and call `onError` (or log to the console).
  Callback errors follow the same path. Initialization failures reject the promise.

Alert conditions must persist for roughly **2 seconds**, after smoothing, and each
alert value has its own **12 second** cooldown. Slouch and sway share the `posture`
cooldown. A continuously bad condition repeats at most once per cooldown.
Calibration and timing use presented **video time**: a replay at 2x reaches two
seconds of behavior in one wall-clock second; pausing does not advance timers.
Seeks/start/recalibration begin a new analysis timeline and clear cooldowns.
MediaPipe receives a separate strictly increasing inference timestamp across seeks.
Repeated frames are skipped. Pauses and gaps over 500ms break sustained conditions;
missing measurements clear the corresponding condition. Valid calibration time is
accumulated only across consecutive usable frames; occlusions do not count.

## Heuristics and tuning

- Slouch: reduced ear-to-shoulder height or shoulder-to-hip height, normalized by
  shoulder width, relative to the calibrated baseline (25%/20% default decreases).
- Sway: horizontal shoulder-center travel over a rolling 1.5-second window exceeds
  0.45 shoulder widths. A single position change expires before the sustained timer.
- Hands: both wrists are low (below shoulders by 0.65 shoulder widths) or hidden
  while shoulders remain tracked. Raising one visible hand clears the condition.
- Head orientation: nose position relative to the eye line, compared with baseline.
  Yaw/pitch thresholds are landmark ratios (0.22/0.18), not angle estimates. This is
  an approximate head-facing proxy, **not eye tracking**. Missing faces are unknown
  and do not produce an eye-contact alert.

Measurements use a time-based exponential moving average (250ms default) and image
aspect correction. Pass `analysis: { ... }` overrides for the exported
`AnalysisOptions` or inspect `DEFAULT_ANALYSIS`. Positive finite values are required.
Defaults need evaluation with actual speakers, lighting, framing and camera angles;
2D landmarks cannot reliably measure forward bending, gaze, or intent. A moving
camera can resemble body sway. If hips/ears/face are out of frame, initial calibration
cannot finish; show progress and ask the speaker to adjust framing.

Both MediaPipe calls run synchronously on the main thread, capped at 15 FPS by
default (`maxFps` is configurable). Target modern browsers supporting MediaPipe's
WASM runtime; test the actual deployment devices. GPU delegation is optional via
`delegate: 'GPU'`; CPU is the default. A worker can be considered if inference
blocks UI rendering. Replay media from another origin must permit CORS access
(set `video.crossOrigin = 'anonymous'` before setting `src`, with server headers).

## Validation scope

Tests use synthetic landmarks and deterministic video timestamps. They cover
calibration, smoothing, sustained alert timing, independent cooldowns, recovery,
tracking gaps, replay time resets, swaying, and posture/hand/head measurements.
Controller tests mock MediaPipe and animation frames to verify frame skipping,
pause/stop, seek timestamps, resource cleanup, and model/inference failures.
The standalone [webcam demo](demo/README.md) includes a mirrored pose skeleton and
face-outline overlay, calibration blockers, landmark counts, pose visibility and
inference/frame timing. Face coordinates do not use pose-style visibility gating:
the MediaPipe JS converter defaults unset face visibility to zero. Applying the pose
threshold to face points rejected valid eyes/nose and kept calibration at 0%; a
regression test now covers this case.

They do not load WASM/models or establish real-camera accuracy. Browser smoke tests
remain necessary: check calibration, occlusion, pause/resume, seek/loop, cleanup,
webcam/replay input, and CPU/GPU behavior on the target device.
