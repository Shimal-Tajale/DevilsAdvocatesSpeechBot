# React preparation

From `frontend/`, run `npm install` and `npm run build`.
The dev and build commands prepare `public/vision/` automatically: model bundles
are copied from the local demo cache when available, otherwise downloaded from
Google's versioned model URLs. WASM files come from the application's pinned
`@mediapipe/tasks-vision` package. Generated assets are ignored by Git and copied
into `dist/vision/` by Vite. A fresh build needs network access for uncached models.

Future React integration can import:

```ts
import { initializeReactVision } from '@/vision/react';
```

This wrapper supplies model and WASM paths using Vite's `BASE_URL`, including
deployments under a subpath. Callers supply callbacks and retain camera ownership.
It does not start the camera or connect to WebSockets.

For live events, use `initializeEventVision(send, options)` from the same entry
point, passing `send` from the screen's existing `useLiveEvents()` instance.
Do not call `connectEvents` again for vision. The initializer forwards each
`onAlert` as `{ type: 'alert', value: 'posture' | 'hands' | 'eye_contact' }`, then
invokes the caller's local callback. That callback must not send the same event
again. Other behavior details remain local; no new wire types are introduced.

The adapter uses the configured analysis cooldown (12 seconds by default) per
category. Failed/offline sends are discarded, never queued for reconnection.
Transport exceptions are isolated from inference. The existing API client owns
reconnection. Display alerts from the server echo to avoid duplicate toasts.

The recording screen now mounts one `useLiveEvents` instance and supplies its
send function to `useRecordingVision`. A responsive mirrored video preview and
canvas show the existing stream and the same pose/face landmarks used for analysis.
Live detector states and calibration progress come from `onStatus`; the last
emitted alert comes only from `onAlert`, separate from candidates and cooldowns.
Camera access starts after audio
recording begins; model loading and calibration may delay the first detection.
Pause suspends inference; resume reuses the camera and models. Ending a recording
or leaving the screen releases both, including late asynchronous results.
Camera/model failures are logged and do not change audio recorder state. Home's
event connection is closed when Home unmounts; vision opens no additional socket.

The recording screen uses a 4% torso drop and 0.04 absolute drop for slouch,
0.2 shoulder-width sway excursions with 3 reversals, and the demo's Sensitive
fidget settings (0.1 excursion, 6 reversals). Wrist/hand visibility gates, pocket
exclusions, head settings and cooldowns remain unchanged. Camera constraints match the demo's
ideal 640x480 user-facing capture. Motion still needs about 5 seconds of valid
history, then 2 seconds sustained evidence for an emitted alert. These settings
are regression-tested on synthetic motion; physical-camera validation is required.

`tsconfig.vision.json` checks this entry point and its imports with the React
compiler settings as part of `npm run build`. The `.tsx` entry keeps Vite-specific
types separate from the standalone Node-oriented vision test configuration.
