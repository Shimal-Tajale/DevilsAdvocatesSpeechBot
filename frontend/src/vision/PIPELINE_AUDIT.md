# Pipeline audit and webcam validation

This audit uses source inspection and generated landmark sequences, not real
webcam recordings. Test results do not establish behavioral accuracy.

## Findings and changes

- Controller: continuous new video frames reach analysis at up to 15fps. Duplicate,
  paused, seeking and unready frames are skipped. Inference timestamps increase
  monotonically; analysis uses presented video time. Synchronous inference may
  cause gaps. Gaps over 500ms, pauses and resets clear history. The UI exposes
  processed gaps, inference time, history size/coverage, reset reason and staleness.
- Coordinates: inference is unmirrored; video/canvas are mirrored together in CSS.
  Image X is aspect-corrected. Heights/wrists use the shoulder axis and width;
  torso-relative sway uses shoulder-minus-hip X. Whole-body translation tracks the
  average shoulder/hip center. Normalized Z is not proof of spinal curvature.
- Visibility: out-of-frame/nonfinite pose points are excluded. Pocket geometry
  requires observed wrists and hips with visibility >=0.75. The panel shows core
  minimum visibility and per-wrist visibility. These are landmark visibility
  values, not an overall tracking confidence or behavior accuracy probability.
  Face per-point visibility is intentionally not used as pose confidence.
- Smoothing: 250ms EMA attenuated short wrist excursions. Wrist geometry now has
  a separate 60ms EMA; posture remains 250ms. Raw/smoothed values appear together.
  Pocket stillness uses raw coordinates to avoid smoothing manufacturing stillness.
- Calibration: previously accumulated valid time across invalid/changing samples.
  Now requires a continuous stable interval anchored to initial posture. Missing
  required geometry, frame gaps and changes restart the interval. Stable bad
  starting posture is inherently unknowable; baseline values are visible and the
  speaker must start upright. Recalibrate when moving the camera or changing framing.
- Slouch: neck shortening previously independently generated posture alerts.
  Head drop alone now cannot trigger slouch; observable torso compression is
  required. Frontal spinal curvature may remain unobservable; no compression is
  reported as uncertainty rather than proof of upright posture.
- Sway: averaging shoulder/hip motion hid some relative movement, and the configured
  window was ignored. Both relative and whole-body movement now have history and
  reversal checks, using the configured window (six seconds by default).
- Reversal bug: a window starting mid-cycle could remain at zero because neither
  half-cycle exceeded the required full excursion from that first sample. Initial
  minimum/maximum tracking fixes this phase dependence. Count hysteresis tolerates
  one reversal aging out; a reversal within 1.5s is required to retain a candidate.
- Fidget: history persists during continuous frames. Independent wrist coordinates
  keep one hand observable when the other disappears; missing samples exclude only
  affected wrist axes. Brief adjustments and large-range gestures are excluded.
  Repeated small speaking gestures can still resemble fidgeting; intent and speech
  activity are not available from these landmarks.
- Front pants pockets: static proximity has been replaced by independent temporal
  entries from the calibrated hands-at-sides baseline. Raw wrist-to-hip horizontal
  distance, signed inward movement, visibility, projected elbow bend and elbow
  outward position feed each hand's state. A baseline-relative minimum excursion
  also accounts for four times measured calibration noise. A visible transition
  must be observed, followed by a hold. Occlusion is accepted only after entry
  with elbow support, and expires four seconds after the last visible entry sample.
  The expiry never refreshes itself from missing wrists. Visible exit clears that
  hand immediately. One-hand evidence does not generate the both-hands message.
  No actual webcam recording was provided; safety bounds/timing are provisional,
  not empirically fitted. Per-hand reasons and evidence scores are inspectable.
- Display: status now arrives before that frame's emitted alerts, preventing labels
  from using the preceding frame. Cooldowns suppress events only, not live states.
  Independent detector explanations, active durations, baselines, thresholds and
  cooldowns remain visible even without a face. A watchdog marks frozen data stale.

MediaPipe coordinate and visibility reference:
https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js

## Real webcam procedure

Launch using `demo/README.md`. Frame a standing speaker from head to slightly below
hips; keep the camera stationary and resting wrists visible. Calibrate upright.
The diagnostic panel is open by default. Green history is whole-body translation;
amber is shoulders relative to hips. The graph auto-scales; numeric amplitudes and
thresholds establish whether movement actually meets the rule.

1. Hold torso upright and look down: inspect neck/head changes and stable torso.
   There should be no slouch candidate from head movement alone.
2. Slouch with a neutral head: inspect whether torso height actually compresses.
   If not, frontal geometry is insufficient; do not compensate with a head-only rule.
3. Sway shoulders over fixed hips, then move hips and shoulders together. Compare
   amber/green traces, history coverage, excursion threshold and reversal counts.
4. Fidget one wrist repeatedly, then use broad gestures or one clothing adjustment.
   Compare raw/smoothed wrist excursions, reversal count, visibility and window size.
5. Rest wrists beside hips, then move inward toward front pocket regions. Inspect
   inward/vertical offsets, distances, visibility and stillness. Fully occluded
   wrists should report uncertainty rather than pocket confirmation.
6. Interrupt tracking, pause, or slow processing. Inspect history resets and stale
   state. Recalibrate and confirm the baseline/progress restart.

Download diagnostic trace saves the last 900 numeric samples locally, without
camera images/audio or network requests. Annotate action times separately; the
trace contains no ground-truth labels. Stop/start clears it; recalibration retains
it for inspection. Use these actual traces before empirical threshold tuning.


## Follow-up: pocketed hands during sway

The original wrist history used shoulder-relative coordinates. Hands fixed at the
hips could therefore appear to move during upper-body sway. Fidget history now
uses hip-relative offsets where available, requires current strong wrist/hand-tip
visibility, and excludes pocket-region/entry hands before adding motion samples.
The relaxed pocket visibility setting never relaxes this fidget gate. Fast entry
with observed inward travel and elbow support can complete through immediate
visibility loss, rather than requiring the wrist to remain visible for 200ms at
its final position. Per-hand candidate labels are now visible even when only one
hand qualifies; combined emitted-pocket events continue to require both hands.

## Screenshot reference: wrists outside skeletal hip centers

The supplied screenshot shows wrists at the front pocket openings slightly outside
MediaPipe's skeletal hip centers. The legacy static region required inward >=0.05
shoulder widths, so this visible pose could be excluded before temporal entry was
considered. `FrontPocketRegion` now separately describes an opening envelope extending
0.18 shoulder widths outside each hip. The legacy `PocketRegion` measurement remains
unchanged for existing consumers. Outer-opening entry additionally requires inward
travel from calibrated rest, elbow support and wrist above hip level; an extended
region alone never proves pockets. This is a geometry correction informed by the
image, not an empirically validated threshold fit.

Failed candidates no longer all become `at_sides`: that state requires proximity
to the calibrated horizontal/vertical resting position and no elbow support. Other
visible poses report uncertainty with an explicit reason. The summary distinguishes
pocket-area evidence from normal hands. Regression fixtures approximate overlay
locations from the screenshot, with generated rest/entry sequences and assumed
visibility; the image itself provides no measured baseline or actual trajectory.
