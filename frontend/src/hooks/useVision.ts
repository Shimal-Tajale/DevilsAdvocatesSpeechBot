import { useCallback, useEffect, useRef, useState } from 'react'
import { initializeVision } from '@/vision'
import type { AlertValue, AnalysisStatus, VisionController } from '@/vision'
import type { VisionStats } from '@/types'

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
}
let shared: Promise<VisionController> | null = null

function loadVision() {
  shared ??= initializeVision({
    ...ASSETS,
    onAlert: (event) => handlers.alert(event.value),
    onStatus: (status) => handlers.status(status),
    onError: (error) => console.error('Vision processing stopped', error),
  }).catch((error) => {
    shared = null // let the next session try again
    throw error
  })
  return shared
}

export type VisionState = 'off' | 'loading' | 'calibrating' | 'watching' | 'unavailable'

interface Tally {
  posture: number
  hands: number
  eye_contact: number
  faceFrames: number // calibrated frames where the face was measurable
  awayFrames: number // ...of which the speaker was looking away
}

const emptyTally = (): Tally => ({ posture: 0, hands: 0, eye_contact: 0, faceFrames: 0, awayFrames: 0 })

// Camera + posture analysis alongside a recording. Best effort: if the camera is
// blocked or the models cannot load, state becomes 'unavailable' and the recording
// carries on without vision stats. Only time spent recording (not paused) is counted.
export function useVision(onAlert: (value: AlertValue) => void) {
  const [state, setState] = useState<VisionState>('off')
  const videoRef = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const controller = useRef<VisionController | null>(null)
  const active = useRef(false) // between record() and stop()
  const counting = useRef(false) // recording, not paused
  const calibrated = useRef(false)
  const tally = useRef<Tally>(emptyTally())
  const onAlertRef = useRef(onAlert)
  useEffect(() => {
    onAlertRef.current = onAlert
  })

  const release = useCallback(() => {
    controller.current?.stop()
    controller.current = null
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const begin = useCallback(async () => {
    active.current = true
    calibrated.current = false
    tally.current = emptyTally()
    setState('loading')

    handlers.alert = (value) => {
      if (!counting.current) return
      tally.current[value] += 1
      onAlertRef.current(value)
    }
    handlers.status = (status) => {
      if (!status.calibrated) return
      if (!calibrated.current) {
        calibrated.current = true
        setState('watching')
      }
      const { headYaw, headPitch } = status.measurements
      if (!counting.current || headYaw === null || headPitch === null) return
      tally.current.faceFrames += 1
      if (status.conditions.eye_contact) tally.current.awayFrames += 1
    }

    try {
      const [media, vision] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false }),
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
      setState((current) => (current === 'loading' ? 'calibrating' : current))
    } catch (error) {
      console.warn('Camera analysis unavailable; recording continues without it', error)
      release()
      if (active.current) setState('unavailable')
    }
  }, [release])

  // Start, or resume after a pause.
  const record = useCallback(() => {
    counting.current = true
    if (!active.current) void begin()
  }, [begin])

  const pause = useCallback(() => {
    counting.current = false
  }, [])

  // Ends the session. Returns undefined when vision never calibrated, so the backend
  // gets no stats rather than zeros that would read as a perfect posture score.
  const stop = useCallback((): VisionStats | undefined => {
    const wasCalibrated = calibrated.current
    active.current = false
    counting.current = false
    release()
    setState('off')
    if (!wasCalibrated) return undefined
    const t = tally.current
    return {
      posture_alerts: t.posture,
      hands_alerts: t.hands,
      eye_contact_alerts: t.eye_contact,
      eye_contact_pct: t.faceFrames ? Math.round(100 * (1 - t.awayFrames / t.faceFrames)) : null,
    }
  }, [release])

  // Leaving the screen mid-session must free the camera.
  useEffect(
    () => () => {
      active.current = false
      counting.current = false
      release()
    },
    [release],
  )

  return { state, videoRef, record, pause, stop }
}
