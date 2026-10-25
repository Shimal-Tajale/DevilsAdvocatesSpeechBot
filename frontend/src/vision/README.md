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
behaviour (slouch, sway, pockets, fidget, eye contact) has its own sustained timer and
**12 second** cooldown, so swaying can alert right after a slouch alert. Events still
name the category (`posture`, `hands`, `eye_contact`), at most one per category per
frame; `status.alertBehaviors` says which behaviour each came from. A continuously bad
behaviour repeats at most once per cooldown.
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


### Diagnostic demo and webcam limits

See [the pipeline audit](PIPELINE_AUDIT.md) for findings and the validation procedure.
The demo shows raw/smoothed inputs, baselines, thresholds, window/reset diagnostics,
per-detector explanations, candidate durations and category cooldowns. Download
diagnostic trace saves the last 900 numeric samples locally, without images/audio.

Calibrate upright and still with the head to slightly below the hips in view.
Missing required landmarks, long gaps and changing posture restart calibration.
A stable bad starting posture cannot be identified automatically. Recalibrate
when changing the camera position or framing.

Slouch candidates require torso compression relative to baseline; head drop alone
never triggers posture. Frontal spinal curvature can remain unobservable. Visible torso geometry near
the saved upright baseline now displays “Upright relative to baseline”; missing
torso geometry remains untracked. This is not proof of spinal alignment. Sway considers shoulder motion
relative to hips and whole-body translation. Wrists use torso-relative coordinates
and 60ms smoothing instead of posture's 250ms smoothing. The motion window honors
`swayWindowMs`. Reversal counting starts with observed extrema; count hysteresis
prevents boundary flicker and recent motion is required. Brief adjustments and
large gestures are excluded. Repeated small gestures can still resemble fidgeting.

Front-pants-pocket detection now requires a temporal entry from independently
calibrated side-resting wrists. Each hand exposes its baseline, inward travel,
projected elbow angle/outward position, visibility, state and heuristic evidence
score. The required inward travel is the larger of an inspectable safety floor
and four times the actual calibration noise. Static hip proximity is insufficient.

After observed entry, a wrist must hold the region for one second; both hands must
qualify before the existing sustained-alert delay emits the `hands` event labeled
“Possible hands in front pockets” in the demo. Elbow bending/outward position
supports the inference. Occlusion is retained only after an observed supported
entry, for at most four seconds after the last valid observation. Arbitrary missing
wrists, lost torso tracking, pauses and exits clear evidence. One-hand entry remains
visible diagnostically but does not trigger the both-hands message.

No real webcam trace was supplied for this change. Calibration noise and relative
positions come from live measurements, but geometric safety bounds and timing
remain provisional heuristics. Inspect/download the diagnostic trace while moving
from sides into front pockets before empirically tuning thresholds. Projected elbow
angles are supporting 2D evidence and cannot confirm clothing contact.

Alert JSON remains unchanged (`posture`, `hands`, `eye_contact`). Optional status
fields carry specific behavior names and diagnostics. Live candidates are separate
from sustained emitted alerts and cooldowns. Automated tests do not establish
webcam accuracy; inspect actual measurements in the diagnostic demo.


### Sensitive demo preset

The demo now starts in **Sensitive** mode. Stop the camera to select the previous
**Conservative** gates, then restart and recalibrate. Library defaults remain
conservative; callers can pass the exported `SENSITIVE_ANALYSIS` as `analysis`.
New numeric analysis options are optional, preserving existing caller objects.

| Gate | Conservative | Sensitive |
| --- | --- | --- |
| Torso height drop from baseline | 12% plus 0.12 shoulder widths | 6% plus 0.06 shoulder widths |
| Sway excursion | 0.45 shoulder widths | 0.20 shoulder widths |
| Sway entry reversals | 6 | 3 |
| Wrist excursion | 0.18 shoulder widths | 0.10 shoulder widths |
| Wrist entry reversals | 10 | 6 |
| Pocket wrist/core visibility | 0.75 | 0.55 |
| Pocket inward-travel floor | 0.08 shoulder widths | 0.05 shoulder widths |
| Wrist baseline samples | 5 | 3 |

Both presets retain a six-second rolling window, two-second alert delay, cooldowns,
noise-relative pocket travel, both-hand temporal entry and limited supported
occlusion memory. Head drop alone, arbitrary missing wrists and one-time body
shifts remain excluded. The measurement and temporal detector receive the same
pocket visibility setting; lowering only the final classifier would leave an
upstream gate blocking evidence. Diagnostics show the active settings and exports
retain them. Visible normal geometry is described separately from an incomplete
pocket baseline.

This is a deliberate sensitivity experiment prompted by reported misses, not an
empirically fitted update. More false positives are possible. Generated time-series
tests verify smaller signals reach the detector and key exclusions remain; actual
webcam traces are still needed to evaluate accuracy.


### Pocket/sway regression update

Fidgeting now has its own 0.80 visibility gate, independent of Sensitive mode's
relaxed pocket gate. Browser measurements include the minimum visibility of each
wrist and its index/pinky/thumb pose points; missing or low-confidence hand points
exclude that hand from fidgeting. Direct measurement callers without hand-tip
metadata still need explicit current wrist visibility. Hip-relative wrist motion
removes shoulders swaying over hands fixed at the hips. Each hand's pocket-region
or active entry evidence also excludes it from fidgeting. Diagnostics explain
eligibility separately from motion amplitude/reversals. Pose visibility remains an
estimate; this cannot prove that a hand is physically visible through clothing.

A fast supported inward approach may now complete when visibility disappears before
the 200ms visible approach delay. This requires observed region entry and sufficient
baseline-relative travel, observed elbow support, recent normal position and a
currently outward elbow. Arbitrary missing wrists remain insufficient. Memory and
sustained holds still expire/apply as before. Single-hand candidates are shown in
the summary; the existing combined pocket alert still requires both hands.

Generated regressions cover upright wording, fast entry then occlusion, upper-body
sway with fixed hip/pocket/occluded wrists, loss of confidence after visible fidgets,
and high-confidence wrist estimates accompanied by low-confidence hand tips. These
changes address identified logic paths and remain unvalidated on real webcam data.

The screenshot-informed front-pocket opening envelope includes wrists slightly
outside skeletal hip centers. Those outer poses require observed inward travel,
elbow support and wrist above hip level. `left/rightFrontPocketRegion` expose the
new envelope; existing `left/rightPocketRegion` remain the narrower legacy geometry.
A rejected candidate is labeled normal only when it matches calibrated rest;
otherwise the demo explains the missing entry evidence. Screenshot-like regression
sequences do not replace testing an actual live entry.

Slouch candidates now use hysteresis: compression must exceed the entry thresholds
to activate, then recover below 65% of those thresholds to clear. This avoids live
label flicker around a single boundary without removing sustained alert timing.
Missing torso data, pauses and recalibration clear the retained state. Both entry
and recovery thresholds are shown in diagnostics. Pocket accuracy remains an open
webcam-validation issue; still screenshots do not reveal temporal entry rejection.

### Disappearing-hand fallback

A trace is not required to use the demo. If the insertion trajectory is missed,
the detector can now infer possible entry from a confidently visible wrist last
seen near its hip, followed promptly by wrist visibility loss and a sustained,
new outward elbow change relative to calibration. The elbow must remain confidently
tracked. It does not require an inferred elbow angle from the hidden wrist.

This path waits 250ms for supporting elbow change, then applies the normal hold
and sustained-alert delay. Its evidence expires four seconds after the last visible
near-hip wrist observation; missing frames cannot refresh it. Visible return,
tracking interruption, absent/weak elbow support and wrists last seen away from hips
clear or reject it. Per-hand diagnostics show `source: disappearance`, the resting
elbow baseline and the rejection reason. This is a possible-pocket heuristic and
cannot distinguish every alternative occlusion, including hands behind the back.
