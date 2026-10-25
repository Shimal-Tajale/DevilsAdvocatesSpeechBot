import { useCallback, useEffect, useRef, useState } from 'react'
import { initializeVision } from '@/vision'
import { RECORDING_POSTURE_ANALYSIS } from '@/vision/sensitivity'
import type { AlertValue, AnalysisStatus, CalibrationBlocker, VisionController } from '@/vision'
import type { AlertDetail, VisionStats } from '@/types'
import type { LandmarkFrame } from '@/vision'
import { LandmarkOverlay } from '@/vision/demo/overlay'

// Same version as the npm package. Loaded from Google's CDN so no model files
// live in the repo; the app needs internet for Deepgram and Gemini anyway.
const ASSETS = {
  wasmRoot: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm',
  poseModelPath:
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  faceModelPath:
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
}

// Models load once per page and are reused by every session (and survive StrictMode
// remounts). The callbacks point at whichever hook is active.
const handlers = {
  alert: (_value: AlertValue) => {},
  status: (_status: AnalysisStatus) => {},
  landmarks: (_frame: LandmarkFrame) => {},
}
let shared: Promise<VisionController> | null = null

function loadVision() {
  shared ??= initializeVision({
    ...ASSETS,
    analysis: RECORDING_POSTURE_ANALYSIS, // Kundansai's tuning for recordings

    onAlert: (event) => handlers.alert(event.value),
    onStatus: (status) => handlers.status(status),
    onLandmarks: (frame) => handlers.landmarks(frame),
    onError: (error) => console.error('Vision processing stopped', error),
  }).catch((error) => {
    shared = null // let the next session try again
    throw error
  })
  return shared
}

export type VisionState = 'off' | 'loading' | 'calibrating' | 'watching' | 'unavailable'

// Why calibration is not progressing, most actionable first. Any blocker on a
// frame restarts the ~3 s calibration timer.
const BLOCKER_ORDER: CalibrationBlocker[] = ['frame_gap', 'torso', 'neck', 'face', 'unstable']

export interface Calibration {
  blocker: CalibrationBlocker | null
  percent: number // 0-100, in steps of 20 so React re-renders rarely
}

interface Tally extends Record<AlertValue | AlertDetail, number> {
  faceFrames: number // calibrated frames where the face was measurable
  awayFrames: number // ...of which the speaker was looking away
}

const emptyTally = (): Tally => ({
  posture: 0, hands: 0, eye_contact: 0,
  slouch: 0, sway: 0, pockets: 0, fidget: 0,
  faceFrames: 0, awayFrames: 0,
})

type Behaviors = NonNullable<AnalysisStatus['behaviors']>

// The module's alerts only say posture/hands; its status (sent just before the
// frame's alerts) says which behaviour each one came from. The behaviours active at
// that moment are a fallback for statuses without that field.
function detailFor(value: AlertValue, status: AnalysisStatus | undefined): AlertDetail | undefined {
  const fired = status?.alertBehaviors?.[value]
  if (fired === 'slouch' || fired === 'sway' || fired === 'pockets' || fired === 'fidget') return fired
  const b: Behaviors | undefined = status?.behaviors
  if (!b) return undefined
  if (value === 'posture') return b.swaying && !b.slouching ? 'sway' : 'slouch'
  if (value === 'hands') return b.possiblePockets ? 'pockets' : 'fidget'
  return undefined
}

// A downloadable video of the session (camera + mic), for replaying the demo later.
export interface Clip {
  url: string
  name: string
}

// Preferred first; Safari only records mp4.
const CLIP_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']

function clipName(mime: string) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  return `speech-${stamp}.${mime.includes('mp4') ? 'mp4' : 'webm'}`
}

// Camera + posture analysis alongside a recording, or on a replayed video file. Best
// effort: if the camera is blocked or the models cannot load, state becomes 'unavailable'
// and the recording carries on without vision stats. Only time spent recording (not
// paused) is counted. Camera sessions also record a clip that can be downloaded.
export function useVision(onAlert: (value: AlertValue, detail?: AlertDetail) => void) {
  const [state, setState] = useState<VisionState>('off')
  const [calibration, setCalibration] = useState<Calibration>({ blocker: null, percent: 0 })
  const lastCalibration = useRef('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<LandmarkOverlay | null>(null)
  const [status, setStatus] = useState<AnalysisStatus | null>(null)
  const [lastAlert, setLastAlert] = useState<{ value: AlertValue; detail?: AlertDetail } | null>(null)
  const lastDisplay = useRef(-Infinity)
  const stream = useRef<MediaStream | null>(null)
  const controller = useRef<VisionController | null>(null)
  const active = useRef(false) // between record() and stop()
  const counting = useRef(false) // recording, not paused
  const calibrated = useRef(false)
  const tally = useRef<Tally>(emptyTally())
  const latestStatus = useRef<AnalysisStatus | undefined>(undefined)
  const [mode, setMode] = useState<'camera' | 'replay' | null>(null)
  const [clip, setClip] = useState<Clip | null>(null)
  const clipRecorder = useRef<MediaRecorder | null>(null)
  const finishReplay = useRef<((stats: VisionStats | undefined) => void) | null>(null)
  const onAlertRef = useRef(onAlert)
  useEffect(() => {
    onAlertRef.current = onAlert
  })

  const release = useCallback(() => {
    overlay.current?.cleanup()
    overlay.current = null
    controller.current?.stop()
    controller.current = null
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    const video = videoRef.current
    if (video) {
      video.pause()
      video.srcObject = null
      video.removeAttribute('src') // a replayed file
      video.muted = true
    }
  }, [])

  // Reset everything for a new camera session or replay, and point the module's
  // callbacks at this hook.
  const prepare = useCallback(() => {
    active.current = true
    calibrated.current = false
    tally.current = emptyTally()
    lastCalibration.current = ''
    setCalibration({ blocker: null, percent: 0 })
    setState('loading')
    setStatus(null)
    setLastAlert(null)
    lastDisplay.current = -Infinity

    handlers.alert = (value) => {
      if (!counting.current) return
      const detail = detailFor(value, latestStatus.current)
      tally.current[value] += 1
      if (detail) tally.current[detail] += 1
      setLastAlert({ value, detail })
      onAlertRef.current(value, detail)
    }
    handlers.landmarks = (frame) => {
      if (!active.current || !canvasRef.current) return
      try {
        overlay.current ??= new LandmarkOverlay(canvasRef.current)
        overlay.current.update(frame)
      } catch (error) {
        // A drawing failure must not stop inference, scoring or event forwarding.
        console.warn('Vision overlay unavailable', error)
      }
    }
    handlers.status = (status) => {
      if (!active.current) return
      latestStatus.current = status
      if (performance.now() - lastDisplay.current >= 150) {
        lastDisplay.current = performance.now()
        setStatus(status)
      }
      if (!status.calibrated) {
        const blocker = BLOCKER_ORDER.find((b) => status.calibrationBlockers.includes(b)) ?? null
        const percent = Math.floor(status.calibrationProgress * 5) * 20
        const key = `${blocker}:${percent}`
        if (key !== lastCalibration.current) {
          if (!lastCalibration.current.startsWith(`${blocker}:`)) {
            console.info('Vision calibration:', blocker ? `waiting on ${status.calibrationBlockers.join(', ')}` : 'progressing')
          }
          lastCalibration.current = key
          setCalibration({ blocker, percent })
        }
        return
      }
      if (!calibrated.current) {
        calibrated.current = true
        setState('watching')
      }
      const { headYaw, headPitch } = status.measurements
      if (!counting.current || headYaw === null || headPitch === null) return
      tally.current.faceFrames += 1
      if (status.conditions.eye_contact) tally.current.awayFrames += 1
    }
  }, [])

  // Records camera + mic into one file while the speaker is recording (pauses skipped).
  const startClip = useCallback((media: MediaStream) => {
    if (typeof MediaRecorder === 'undefined' || media.getAudioTracks().length === 0) return
    const mime = CLIP_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
    const chunks: Blob[] = []
    const rec = new MediaRecorder(media, mime ? { mimeType: mime } : undefined)
    rec.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    rec.onstop = () => {
      if (chunks.length === 0) return
      const type = rec.mimeType || mime || 'video/webm'
      setClip({ url: URL.createObjectURL(new Blob(chunks, { type })), name: clipName(type) })
    }
    rec.start(1000)
    if (!counting.current) rec.pause()
    clipRecorder.current = rec
  }, [])

  const begin = useCallback(async () => {
    prepare()
    setMode('camera')
    setClip(null)
    try {
      const [media, vision] = await Promise.all([
        // The mic is only for the downloadable clip; vision uses the picture.
        navigator.mediaDevices
          .getUserMedia({ video: { width: 640, height: 480 }, audio: true })
          .catch(() => navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })),
        loadVision(),
      ])
      if (!active.current || !videoRef.current) {
        media.getTracks().forEach((track) => track.stop()) // stopped while loading
        return
      }
      stream.current = media
      videoRef.current.srcObject = media
      await videoRef.current.play()
      vision.start(videoRef.current)
      controller.current = vision
      startClip(media)
      setState((current) => (current === 'loading' ? 'calibrating' : current))
    } catch (error) {
      console.warn('Camera analysis unavailable; recording continues without it', error)
      release()
      if (active.current) setState('unavailable')
    }
  }, [prepare, release, startClip])

  // Start, or resume after a pause.
  const record = useCallback(() => {
    counting.current = true
    if (!active.current) void begin()
    else if (clipRecorder.current?.state === 'paused') clipRecorder.current.resume()
  }, [begin])

  const pause = useCallback(() => {
    counting.current = false
    if (clipRecorder.current?.state === 'recording') clipRecorder.current.pause()
  }, [])

  // Ends the session or replay. Returns undefined when vision never calibrated, so the
  // backend gets no stats rather than zeros that would read as a perfect posture score.
  const stop = useCallback((): VisionStats | undefined => {
    const wasCalibrated = calibrated.current
    active.current = false
    counting.current = false
    if (clipRecorder.current && clipRecorder.current.state !== 'inactive') clipRecorder.current.stop()
    clipRecorder.current = null
    release()
    setState('off')
    setMode(null)
    const t = tally.current
    const stats: VisionStats | undefined = wasCalibrated
      ? {
          posture_alerts: t.posture,
          hands_alerts: t.hands,
          eye_contact_alerts: t.eye_contact,
          eye_contact_pct: t.faceFrames ? Math.round(100 * (1 - t.awayFrames / t.faceFrames)) : null,
          slouch_alerts: t.slouch,
          sway_alerts: t.sway,
          pocket_alerts: t.pockets,
          fidget_alerts: t.fidget,
        }
      : undefined
    finishReplay.current?.(stats)
    finishReplay.current = null
    return stats
  }, [release])

  // Replay mode: run the same analysis on a recorded video, played with sound, so alerts
  // (toasts, mascot, robot) fire in sync with it. Resolves with the stats when the video
  // ends or stop() is called.
  const replay = useCallback(
    (url: string) =>
      new Promise<VisionStats | undefined>((resolve) => {
        const video = videoRef.current
        if (!video) return resolve(undefined)
        prepare()
        setMode('replay')
        counting.current = true
        finishReplay.current = resolve
        void (async () => {
          try {
            const vision = await loadVision()
            if (!active.current) return
            video.srcObject = null
            video.src = url
            video.muted = false
            video.addEventListener('ended', () => stop(), { once: true })
            vision.start(video)
            controller.current = vision
            setState((current) => (current === 'loading' ? 'calibrating' : current))
            await video.play()
          } catch (error) {
            console.warn('Replay analysis unavailable', error)
            stop()
            setState('unavailable')
          }
        })()
      }),
    [prepare, stop],
  )

  // A new clip replaces the old one; the old download link is no longer needed.
  const clipUrl = clip?.url
  useEffect(() => () => {
    if (clipUrl) URL.revokeObjectURL(clipUrl)
  }, [clipUrl])

  // Leaving the screen mid-session must free the camera.
  useEffect(
    () => () => {
      active.current = false
      counting.current = false
      if (clipRecorder.current && clipRecorder.current.state !== 'inactive') {
        clipRecorder.current.onstop = null
        clipRecorder.current.stop()
      }
      release()
    },
    [release],
  )

  return { state, mode, clip, calibration, videoRef, canvasRef, status, lastAlert, record, pause, stop, replay }
}
