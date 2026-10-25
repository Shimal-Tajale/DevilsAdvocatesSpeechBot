import { motion } from 'framer-motion'
import { Check, Loader2, Mic, Pause, Play, RotateCcw, Square, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createSession, postSpeech } from '@/api'
import { Mascot } from '@/components/Mascot'
import { ThemeToggle } from '@/components/ThemeToggle'
import { VolumeMeter } from '@/components/VolumeMeter'
import { Button } from '@/components/ui/button'
import { useRecorder, type RecorderState } from '@/hooks/useRecorder'
import { useSpeaker } from '@/hooks/useSpeaker'
import { MODES } from '@/modes'
import type { Mood, ModeId } from '@/types'

const MIN_SECONDS = 5
const PROGRESS_STEPS = ['Transcribing', 'Measuring', 'Writing feedback']

const inputClass =
  'h-11 rounded-2xl border-2 border-foreground/15 bg-card px-4 text-base outline-none focus-visible:border-mode-strong focus-visible:ring-3 focus-visible:ring-mode-strong/30'
const bigButton = 'h-14 gap-2 rounded-full px-8 text-lg font-semibold'

const MIC_HELP: Partial<Record<RecorderState, { title: string; body: string }>> = {
  denied: {
    title: 'The microphone is blocked',
    body: 'Earnest cannot hear you yet. Click the lock or settings icon next to the web address, switch Microphone to Allow, then press Try again.',
  },
  no_mic: {
    title: 'No microphone found',
    body: 'Plug one in, or check that your device sound settings list a microphone, then press Try again.',
  },
  unsupported: {
    title: 'This page cannot record',
    body: 'Browsers only allow microphone access on secure pages. Open the https link (such as the shared ngrok link) in an up-to-date Chrome, Safari or Firefox.',
  },
  error: {
    title: 'Something went wrong with the microphone',
    body: 'Press Try again. If it keeps happening, reload the page.',
  },
}

function formatTime(ms: number) {
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

type Analysis = 'idle' | 'running' | 'failed' | 'done'

export default function Session({ mode }: { mode: ModeId }) {
  const config = MODES.find((m) => m.id === mode)!
  const navigate = useNavigate()
  const recorder = useRecorder()
  const [speaker, setSpeaker] = useSpeaker()
  const [topic, setTopic] = useState('')
  const [targetMinutes, setTargetMinutes] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [step, setStep] = useState<'setup' | 'session'>('setup')

  const [analysis, setAnalysis] = useState<Analysis>('idle')
  const [progress, setProgress] = useState(0)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const sessionId = useRef<string | null>(null)
  const navTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const targetSeconds = targetMinutes.trim() ? Math.round(Number(targetMinutes) * 60) : undefined

  // Progress messages are timed, because the backend does not report which stage it is in.
  useEffect(() => {
    if (analysis !== 'running') return
    const timer = setInterval(() => setProgress((p) => Math.min(p + 1, PROGRESS_STEPS.length - 1)), 3500)
    return () => clearInterval(timer)
  }, [analysis])

  useEffect(() => () => clearTimeout(navTimer.current), [])

  const mood: Mood =
    analysis === 'done'
      ? 'happy'
      : analysis === 'running'
        ? 'thinking'
        : recorder.state === 'recording'
          ? 'listening'
          : 'idle'

  const submitSetup = (event: FormEvent) => {
    event.preventDefault()
    if (!speaker.trim()) return setFormError('Please tell me your name.')
    if (!topic.trim()) return setFormError('Please add a topic so I know what to listen for.')
    if (targetMinutes.trim() && !(Number(targetMinutes) > 0 && Number(targetMinutes) <= 180)) {
      return setFormError('Target length should be between a few seconds and 180 minutes.')
    }
    setFormError(null)
    setStep('session')
  }

  const analyze = async () => {
    const recording = recorder.recording
    if (!recording) return
    setAnalysis('running')
    setProgress(0)
    setAnalysisError(null)
    try {
      if (!sessionId.current) {
        const session = await createSession({ speaker: speaker.trim(), mode, topic: topic.trim() })
        sessionId.current = session.session_id
      }
      const result = await postSpeech(recording.blob, { session_id: sessionId.current, target_length_sec: targetSeconds })
      setAnalysis('done')
      const id = sessionId.current
      navTimer.current = setTimeout(() => navigate(`/results/${id}`, { state: { result, mode } }), 1200)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      if (message === 'Session not found') sessionId.current = null // e.g. the server restarted
      setAnalysisError(message)
      setAnalysis('failed')
    }
  }

  const reRecord = () => {
    setAnalysis('idle')
    setAnalysisError(null)
    recorder.reset()
  }

  const editDetails = () => {
    sessionId.current = null
    setStep('setup')
  }

  const { state } = recorder
  const recordingActive = state === 'recording' || state === 'paused'
  const shortRecording = recorder.recording ? recorder.recording.durationMs < MIN_SECONDS * 1000 : false

  return (
    <div data-mode={mode} className="page-mode min-h-dvh pb-10 text-foreground">
      <main className="mx-auto flex w-full max-w-xl flex-col items-center gap-5 px-4 py-6 text-center sm:px-6">
        <div className="flex w-full items-center justify-between text-sm font-semibold">
          <Link to="/" className="underline underline-offset-4">
            Back to home
          </Link>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-mode px-3 py-1 text-plum">{config.title}</span>
            <ThemeToggle />
          </div>
        </div>

        <div className="relative">
          <div aria-hidden className="absolute inset-x-4 top-12 bottom-0 rounded-full bg-mode-soft ring-4 ring-mode/60" />
          <Mascot mood={mood} className={`relative ${step === 'setup' ? 'w-40 sm:w-48' : 'w-56 sm:w-72'}`} />
        </div>

        {step === 'setup' ? (
          <form onSubmit={submitSetup} className="flex w-full flex-col gap-4 text-left" noValidate>
            <h1 className="text-center text-2xl font-semibold sm:text-3xl">Let&apos;s get ready</h1>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="speaker" className="font-semibold">
                Your name
              </label>
              <input id="speaker" className={inputClass} value={speaker} onChange={(e) => setSpeaker(e.target.value)} placeholder="Your name" autoComplete="given-name" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="topic" className="font-semibold">
                {config.topicLabel}
              </label>
              <input id="topic" className={inputClass} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={config.topicPlaceholder} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="target" className="font-semibold">
                Target length in minutes <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input id="target" className={inputClass} type="number" inputMode="decimal" min="0.5" max="180" step="0.5" value={targetMinutes} onChange={(e) => setTargetMinutes(e.target.value)} placeholder="3" />
            </div>
            {formError && (
              <p role="alert" className="rounded-2xl bg-coral/20 px-4 py-2 font-semibold">
                {formError}
              </p>
            )}
            <Button type="submit" className={`${bigButton} self-center bg-mode-strong text-on-mode-strong hover:bg-mode-strong/90`}>
              Continue
            </Button>
          </form>
        ) : (
          <>
            <div className="flex flex-col items-center gap-1">
              <p role="timer" aria-label="Recorded time" className="font-heading text-6xl font-semibold tabular-nums sm:text-7xl">
                {formatTime(recorder.elapsedMs)}
              </p>
              {targetSeconds && <p className="text-muted-foreground">of {formatTime(targetSeconds * 1000)} target</p>}
              <p className="font-semibold text-mode-strong">{topic.trim()}</p>
            </div>

            <VolumeMeter level={recorder.level} active={recordingActive} />

            {analysis === 'idle' && state === 'idle' && (
              <>
                <p role="status">Press Start when you are ready. I will wait.</p>
                <div className="flex flex-wrap justify-center gap-3">
                  <Button onClick={recorder.start} className={`${bigButton} bg-mode-strong text-on-mode-strong hover:bg-mode-strong/90`}>
                    <Mic className="size-5" aria-hidden /> Start
                  </Button>
                  <Button variant="outline" onClick={editDetails} className="h-14 rounded-full border-2 border-foreground/20 bg-card px-6 text-base font-semibold">
                    Edit details
                  </Button>
                </div>
              </>
            )}

            {state === 'requesting' && (
              <p role="status" className="flex items-center gap-2 font-semibold">
                <Loader2 className="size-5 animate-spin" aria-hidden /> Waiting for microphone permission. Choose Allow in your browser.
              </p>
            )}

            {recordingActive && (
              <>
                <p role="status" className="font-semibold">
                  {state === 'recording' ? 'Listening. Speak whenever you like.' : 'Paused. Your time is not counting.'}
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  {state === 'recording' ? (
                    <Button onClick={recorder.pause} className={`${bigButton} bg-butter text-plum hover:bg-butter/85`}>
                      <Pause className="size-5" aria-hidden /> Pause
                    </Button>
                  ) : (
                    <Button onClick={recorder.resume} className={`${bigButton} bg-mint text-plum hover:bg-mint/85`}>
                      <Play className="size-5" aria-hidden /> Resume
                    </Button>
                  )}
                  <Button onClick={recorder.stop} className={`${bigButton} bg-coral text-plum hover:bg-coral/85`}>
                    <Square className="size-5" aria-hidden /> Stop
                  </Button>
                </div>
              </>
            )}

            {MIC_HELP[state] && (
              <div role="alert" className="flex w-full flex-col items-center gap-3 rounded-3xl border-2 border-coral bg-card p-5">
                <TriangleAlert className="size-6 text-coral" aria-hidden />
                <h2 className="text-lg font-semibold">{MIC_HELP[state]!.title}</h2>
                <p>{MIC_HELP[state]!.body}</p>
                <Button onClick={recorder.start} className="h-11 rounded-full bg-plum px-6 text-base font-semibold text-warm hover:bg-plum/90">
                  Try again
                </Button>
              </div>
            )}

            {state === 'review' && recorder.recording && analysis !== 'running' && analysis !== 'done' && (
              <div className="flex w-full flex-col items-center gap-4">
                <h2 className="text-xl font-semibold">Listen back</h2>
                <audio controls src={recorder.recording.url} className="w-full" />
                {shortRecording && (
                  <p role="status" className="flex items-start gap-2 rounded-2xl bg-butter/50 px-4 py-3 text-left">
                    <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
                    That is under {MIN_SECONDS} seconds, which may be too short to give you good feedback. You can re-record or analyze it anyway.
                  </p>
                )}
                {analysis === 'failed' && (
                  <div role="alert" className="flex w-full flex-col gap-1 rounded-3xl border-2 border-coral bg-card p-4 text-left">
                    <p className="font-semibold">The analysis did not work.</p>
                    <p>{analysisError}</p>
                  </div>
                )}
                <div className="flex flex-wrap justify-center gap-3">
                  <Button variant="outline" onClick={reRecord} className="h-14 gap-2 rounded-full border-2 border-foreground/20 bg-card px-6 text-base font-semibold">
                    <RotateCcw className="size-5" aria-hidden /> Re-record
                  </Button>
                  <Button onClick={analyze} className={`${bigButton} bg-mode text-plum hover:bg-mode/85`}>
                    {analysis === 'failed' ? 'Try again' : 'Analyze'}
                  </Button>
                </div>
              </div>
            )}

            {(analysis === 'running' || analysis === 'done') && (
              <ol className="flex w-full max-w-xs flex-col gap-2 text-left" aria-label="Analysis progress">
                {PROGRESS_STEPS.map((label, i) => {
                  const finished = analysis === 'done' || i < progress
                  const current = analysis === 'running' && i === progress
                  return (
                    <motion.li key={label} initial={{ opacity: 0.4 }} animate={{ opacity: finished || current ? 1 : 0.4 }} className="flex items-center gap-2 text-lg font-semibold">
                      {finished ? <Check className="size-5 text-foreground" aria-hidden /> : current ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <span className="size-5" />}
                      {label}
                      {current ? '...' : ''}
                    </motion.li>
                  )
                })}
                {analysis === 'done' && <li className="pt-2 text-lg font-semibold">Your results are ready!</li>}
              </ol>
            )}
          </>
        )}
      </main>
    </div>
  )
}
