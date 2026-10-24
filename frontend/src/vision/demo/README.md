# Standalone webcam demo

This page imports the existing vision module's `initializeVision` API. It does not
use React, modify the shared frontend, record audio/video, or connect to WebSockets.
All demo sources, generated files and downloaded models stay inside this directory.
WASM and the browser ESM bundle are served from the vision module's existing npm
installation, keeping the runtime and assets at the same version.

## Launch locally

Requirements: Node.js 20+ (tested with Node 24), npm, Python 3, a webcam, and a current
Chrome, Edge, Firefox or Safari supporting import maps and WebAssembly. Internet is
needed for the first dependency install and model download.

From the repository root, run:

```sh
cd frontend/src/vision
npm ci
node demo/launch.mjs
```

Open **http://127.0.0.1:5173/demo/** in your browser. Click **Start Camera** and grant
camera permission. The launch script compiles the module/demo with the installed
TypeScript compiler, downloads missing models, then starts a Python HTTP server on
127.0.0.1:5173. Later launches need only `node demo/launch.mjs` from that directory.
Press Ctrl+C in the terminal to stop the server. Click **Stop Camera** in the page
to release the webcam; closing the server alone does not close browser camera tracks.

Do not open `index.html` using `file://`, or serve only the `demo` directory. The HTTP
server root must be **frontend/src/vision** so the import map can resolve the existing
MediaPipe package. This server is isolated from Abhiram's React/Vite dev server.

For explicit setup/build/serve commands instead of the launcher, from
`frontend/src/vision`:

```sh
node demo/setup-assets.mjs
npm exec -- tsc -p demo/tsconfig.json
python3 -m http.server 5173 --bind 127.0.0.1 --directory .
```

The setup script downloads these versioned bundles from Google's official model
storage into the ignored `demo/assets/` directory:

- [Pose Landmarker Lite, float16 v1](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task)
- [Face Landmarker, float16 v1](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task)

These are the model paths shown in [Google's MediaPipe samples](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md).
Existing bundles are reused on subsequent launches. To replace a corrupted bundle,
remove that file from `demo/assets/` and rerun setup. For an offline machine, copy
the two bundles into that folder with the exact filenames above and install npm
dependencies before going offline. Generated JavaScript is ignored in `demo/.build/`.

## Try it

1. Start the camera and keep one speaker's face, ears, shoulders and hips in view.
   Stay upright facing the camera until calibration reaches 100% (about three
   seconds of usable video). If progress stalls, improve framing and lighting.
2. Slouch or sway repeatedly for several seconds to test `posture`.
3. Keep both hands hidden or low for several seconds to test `hands`.
4. Turn your head away from the baseline for several seconds to test `eye_contact`.
5. Use **Recalibrate** after moving the camera or changing speakers.
6. Click **Stop Camera**, including while models load, and confirm the browser
   camera indicator turns off. Start again to begin fresh calibration.

Current conditions come directly from `onStatus`; they are not emitted alerts.
The recent-alert list shows only `onAlert` events with their exact JSON payloads
and local receipt time, capped at 30 entries. The module handles smoothing, the
two-second sustained timer and twelve-second cooldowns. Head ratios are not degrees
or actual gaze measurements. Untracked landmarks display **Not tracked** rather than
**Clear**; see the parent module README for heuristic limits.

## Landmark overlay and calibration diagnostics

The transparent canvas draws pose dots and MediaPipe skeleton connections, plus a
simple face oval and eye/nose anchors. White dots have pose visibility ≥ 0.5; amber
dots indicate low visibility and do not connect into the skeleton. Blue marks show
face coordinates, which do not use pose-style visibility scores. Points outside
the video frame are not drawn. Both video and canvas use the same CSS mirror;
letterbox offsets are calculated from the intrinsic video size. The canvas resizes
with the preview and uses the device pixel ratio for sharp lines.

The module's optional `onLandmarks` callback exposes the results already produced
by its Pose and Face Landmarkers. The overlay does not create additional detectors
or run inference. It clears on missing detections or camera stop. The diagnostics
panel reports raw pose/face point counts, usable pose-point counts, ear/shoulder/hip
visibility, video resolution, inference time and processed-frame gap. Calibration
blockers below the progress bar identify missing neck, torso or face measurements,
or frame gaps exceeding the configured continuity limit (500ms by default).

Investigation identified a code bug: the same visibility ≥ 0.5 check was used for
pose and face points. In the installed MediaPipe JS bundle, an unset landmark
visibility becomes zero. Valid face eye/nose coordinates with `visibility: 0` were
therefore rejected, displayed as **Not tracked**, and blocked the head measurements
required by calibration. Face measurements now validate finite coordinates rather
than per-point visibility; pose confidence checks are preserved. A regression test
reproduces 0% before the fix and reaches 100% with the corrected measurements.

This does not establish whether every webcam failure has the same cause. If the
diagnostic says **No face returned**, the actual Face Landmarker returned an empty
result; check framing, light and face size. If it reports 478 face points but hips
are low-visibility, adjust body framing. If frame gaps repeatedly exceed 500ms,
calibration cannot accumulate continuous time; close busy apps or test a faster
device. Keep the thresholds unchanged while diagnosing the missing measurements.

## Errors and troubleshooting

- **Permission blocked:** allow camera access for this origin in browser settings
  and in OS privacy settings. Click Start Camera again after changing permissions.
- **No camera / camera busy:** connect a webcam or close other apps using it.
- **Missing model (404):** run `node demo/setup-assets.mjs`; model URLs under
  `/demo/assets/` must return files. Failed setup reports the URL/error in the terminal.
- **Missing WASM or module:** run `npm ci` in `frontend/src/vision`, compile again,
  and check the server root. WASM URLs are under
  `/node_modules/@mediapipe/tasks-vision/wasm/`. Both SIMD and non-SIMD files are checked.
- **Demo could not load:** compile with `npm exec -- tsc -p demo/tsconfig.json` and
  reload. The page reports module-import failures instead of silently disabling buttons.
- **Inference/model initialization error:** the error is shown in the page; the
  camera is released. Check browser support, asset integrity and the console, then retry.
- **Address already in use:** stop the other process on port 5173, or use the manual
  server command with a different port and open `/demo/` there. Asset paths are relative.
- **Camera API unavailable:** use localhost/127.0.0.1 or HTTPS, not a plain HTTP LAN
  address. Ensure browser/site policies permit camera access.

Stop cancels active asset checks immediately. Browser camera permission prompts and
MediaPipe initialization cannot always be cancelled; late camera streams are stopped
and late model instances are cleaned up without restarting processing. Navigating
away also releases resources. Models may still finish loading after Stop.

## Validation

From `frontend/src/vision`:

```sh
npm test
npm run typecheck
npm exec -- tsc -p demo/tsconfig.json --noEmit
npm exec -- tsc -p demo/tsconfig.json
node --test demo/tests/*.test.mjs
```

The demo tests mock camera/model dependencies to check stop-during-start races,
track release, error handling and cleanup, plus drawing coordinates, letterboxing,
missing-landmark diagnostics and callback forwarding. Existing module tests cover
vision measurements/timing, face visibility regression and reuse of inference
results. Real webcam framing, permissions and model inference must
also be checked manually in a browser; automated tests do not establish accuracy.
