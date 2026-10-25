import { useCallback, useEffect, useRef, useState } from 'react'

export type RecorderState =
  | 'idle'
  | 'requesting' // waiting for the browser's permission prompt
  | 'recording'
  | 'paused'
  | 'review'
  | 'denied'
  | 'no_mic'
  | 'unsupported' // no getUserMedia (usually plain http on a phone)
  | 'error'

export interface Recording {
  blob: Blob // blob.type is the recording's real MIME type
  url: string // object URL for playback
  durationMs: number // recorded time only, pauses excluded
}

// Preferred first; Safari only does mp4 and Chrome/Firefox do webm or ogg.
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
}

// Microphone recording with pause/resume, a recorded-time timer and a live input level.
export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [level, setLevel] = useState(0) // 0..1
  const [recording, setRecording] = useState<Recording | null>(null)

  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const audioContext = useRef<AudioContext | null>(null)
  const frame = useRef(0)
  const tick = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const segmentStart = useRef<number | null>(null) // when the current recording stretch began
  const accumulated = useRef(0) // recorded ms before the current stretch
  const url = useRef<string | null>(null)

  const release = useCallback(() => {
    clearInterval(tick.current)
    cancelAnimationFrame(frame.current)
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    void audioContext.current?.close()
    audioContext.current = null
  }, [])

  const watchLevel = useCallback((source: MediaStream) => {
    const context = new AudioContext()
    audioContext.current = context
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    context.createMediaStreamSource(source).connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    let lastUpdate = 0
    const loop = (now: number) => {
      frame.current = requestAnimationFrame(loop)
      if (now - lastUpdate < 50) return // about 20 updates a second is plenty for a meter
      lastUpdate = now
      analyser.getByteTimeDomainData(samples)
      let sum = 0
      for (const value of samples) sum += ((value - 128) / 128) ** 2
      setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 3))
    }
    frame.current = requestAnimationFrame(loop)
  }, [])

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState('unsupported')
      return
    }
    setState('requesting')
    let media: MediaStream
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      if (name === 'NotFoundError' || name === 'OverconstrainedError') setState('no_mic')
      else if (name === 'NotAllowedError' || name === 'SecurityError') setState('denied')
      else setState('error')
      return
    }
    stream.current = media
    const mimeType = pickMimeType()
    const chunks: Blob[] = []
    const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined)
    rec.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    rec.onstop = () => {
      const durationMs = accumulated.current
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' })
      release()
      url.current = URL.createObjectURL(blob)
      setLevel(0)
      setElapsedMs(durationMs)
      setRecording({ blob, url: url.current, durationMs })
      setState('review')
    }
    rec.onerror = () => {
      rec.onstop = null
      release()
      setState('error')
    }
    recorder.current = rec
    accumulated.current = 0
    segmentStart.current = Date.now()
    setElapsedMs(0)
    rec.start()
    watchLevel(media)
    tick.current = setInterval(() => {
      const running = segmentStart.current ? Date.now() - segmentStart.current : 0
      setElapsedMs(accumulated.current + running)
    }, 200)
    setState('recording')
  }, [release, watchLevel])

  const pause = useCallback(() => {
    if (recorder.current?.state !== 'recording') return
    recorder.current.pause()
    accumulated.current += Date.now() - (segmentStart.current ?? Date.now())
    segmentStart.current = null
    setElapsedMs(accumulated.current)
    setState('paused')
  }, [])

  const resume = useCallback(() => {
    if (recorder.current?.state !== 'paused') return
    recorder.current.resume()
    segmentStart.current = Date.now()
    setState('recording')
  }, [])

  const stop = useCallback(() => {
    const rec = recorder.current
    if (!rec || rec.state === 'inactive') return
    if (segmentStart.current) accumulated.current += Date.now() - segmentStart.current
    segmentStart.current = null
    rec.stop()
  }, [])

  const reset = useCallback(() => {
    if (url.current) URL.revokeObjectURL(url.current)
    url.current = null
    setRecording(null)
    setElapsedMs(0)
    setLevel(0)
    setState('idle')
  }, [])

  // Leaving the screen mid-recording must free the microphone.
  useEffect(
    () => () => {
      if (recorder.current && recorder.current.state !== 'inactive') {
        recorder.current.onstop = null
        recorder.current.stop()
      }
      release()
      if (url.current) URL.revokeObjectURL(url.current)
    },
    [release],
  )

  return { state, elapsedMs, level, recording, start, pause, resume, stop, reset }
}
