import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSession, postSpeech } from '@/api'

interface DevRecordTestProps {
  speaker: string
}

type Phase = 'idle' | 'recording' | 'sending'

// Development-only: records from the microphone and runs the full real flow
// (POST /sessions, then POST /speech with the session_id, then the Results screen).
// The real recording screen comes later. Renders nothing in production builds.
export function DevRecordTest({ speaker }: DevRecordTestProps) {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  if (!import.meta.env.DEV) return null

  const start = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const chunks: Blob[] = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = (e) => chunks.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setPhase('sending')
        try {
          const session = await createSession({
            speaker: speaker.trim() || 'Dev',
            mode: 'presentation',
            topic: 'Dev test recording',
          })
          const result = await postSpeech(new Blob(chunks, { type: rec.mimeType }), { session_id: session.session_id })
          navigate(`/results/${session.session_id}`, { state: { result } })
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Something went wrong')
          setPhase('idle')
        }
      }
      rec.start()
      recorder.current = rec
      setPhase('recording')
    } catch {
      setError('Could not open the microphone')
    }
  }

  const stop = () => recorder.current?.stop()
  const chip =
    'rounded-full bg-mint px-3 py-1.5 text-sm font-semibold text-plum transition-colors hover:bg-mint/85 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lavender'
  return (
    <>
      <button
        type="button"
        className={chip}
        disabled={phase === 'sending'}
        onClick={phase === 'recording' ? stop : start}
      >
        {phase === 'idle' && 'record test speech (real backend)'}
        {phase === 'recording' && 'stop and analyze'}
        {phase === 'sending' && 'analyzing...'}
      </button>
      {error && <span role="alert" className="rounded-full bg-coral px-3 py-1.5 text-sm font-semibold text-plum">{error}</span>}
    </>
  )
}
