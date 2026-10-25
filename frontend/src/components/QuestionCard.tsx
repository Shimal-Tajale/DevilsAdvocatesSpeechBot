import { motion } from 'framer-motion'
import { ExternalLink, Loader2, Mic, RotateCcw, Square, Volume2 } from 'lucide-react'
import { useState } from 'react'
import { askQuestion, rateAnswer } from '@/api'
import { TakeQuestionButton } from '@/components/TakeQuestionButton'
import { Button } from '@/components/ui/button'
import { useRecorder } from '@/hooks/useRecorder'
import { scoreLabel } from '@/lib/scoring'
import type { AnswerResult, AudienceQuestion, ModeId } from '@/types'

// The same flow in every mode; only the words change (the backend picks the prompt).
const COPY: Record<ModeId, {
  heading: string; working: string; about: string; asked: string; answer: string; yours: string
}> = {
  presentation: {
    heading: 'A question from the audience', working: 'Earnest is checking one of your claims...',
    about: 'About', asked: 'Earnest asked', answer: 'Answer it', yours: 'Your answer',
  },
  debate: {
    heading: "Your opponent's counter-argument", working: 'Earnest is building the case against you...',
    about: 'Your position', asked: 'Earnest argued', answer: 'Rebut it', yours: 'Your rebuttal',
  },
  interview: {
    heading: 'An interview question', working: 'Earnest is thinking of a question about you...',
    about: 'Probing', asked: 'Earnest asked', answer: 'Answer it', yours: 'Your answer',
  },
}
type Copy = (typeof COPY)[ModeId]

// The browser's voice: the design doc's text-to-speech fallback.
function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
}

type Phase = 'waiting' | 'asking' | 'asked' | 'failed'

const pill = 'h-11 gap-2 self-start rounded-full px-5 text-base font-semibold'

// Answer the question once: record, stop, rate. Re-recording is only offered if the
// rating failed (e.g. no speech was heard), not after a score.
function AnswerBox({ sessionId, asked, copy }: { sessionId: string; asked: AudienceQuestion; copy: Copy }) {
  const recorder = useRecorder()
  const [rating, setRating] = useState<'idle' | 'rating' | 'failed'>('idle')
  const [result, setResult] = useState<AnswerResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { state } = recorder

  const start = () => {
    window.speechSynthesis?.cancel() // or the mic records the question being read out
    void recorder.start()
  }

  const rate = async () => {
    if (!recorder.recording) return
    setRating('rating')
    setError(null)
    try {
      const answer = await rateAnswer(sessionId, recorder.recording.blob, asked)
      setResult(answer)
      speak(answer.rating.robot_line)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setRating('failed')
    }
  }

  if (result) {
    const { score, answered, did_well, improve } = result.rating
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2 border-t border-foreground/10 pt-3">
        <h3 className="font-semibold">{copy.yours}</h3>
        <p className="font-heading text-3xl font-semibold">
          {score}/10 <span className="text-base font-semibold text-muted-foreground">{scoreLabel(score)}</span>
        </p>
        {!answered && <p className="rounded-2xl bg-butter/50 px-3 py-2">That did not quite answer the question.</p>}
        <p>
          <span className="font-semibold">Did well: </span>
          {did_well}
        </p>
        <p>
          <span className="font-semibold">Try next: </span>
          {improve}
        </p>
        <p className="text-sm text-muted-foreground">
          {result.metrics.wpm} words per minute, {result.metrics.fillers} filler{result.metrics.fillers === 1 ? '' : 's'}
        </p>
        <dl className="flex flex-col gap-2 rounded-2xl bg-card p-3 text-sm" aria-label="Transcript of the question and your answer">
          <div>
            <dt className="font-semibold">{copy.asked}</dt>
            <dd>{asked.question}</dd>
          </div>
          <div>
            <dt className="font-semibold">You said</dt>
            <dd>{result.transcript}</dd>
          </div>
        </dl>
      </motion.div>
    )
  }

  return (
    <div className="flex flex-col gap-2 border-t border-foreground/10 pt-3">
      <h3 className="font-semibold">{copy.yours}</h3>
      {state === 'idle' && (
        <Button onClick={start} className={`${pill} bg-mode-strong text-on-mode-strong hover:bg-mode-strong/90`}>
          <Mic className="size-5" aria-hidden /> {copy.answer}
        </Button>
      )}
      {state === 'requesting' && <p role="status">Waiting for microphone permission...</p>}
      {(state === 'recording' || state === 'paused') && (
        <>
          <p role="timer" className="font-semibold">
            Recording your answer... {Math.floor(recorder.elapsedMs / 1000)}s
          </p>
          <Button onClick={recorder.stop} className={`${pill} bg-coral text-plum hover:bg-coral/85`}>
            <Square className="size-5" aria-hidden /> Stop
          </Button>
        </>
      )}
      {(state === 'denied' || state === 'no_mic' || state === 'unsupported' || state === 'error') && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p>The microphone is not available, so I cannot hear your answer.</p>
          <Button variant="outline" onClick={start} className={`${pill} border-2 border-foreground/20 bg-card`}>
            Try again
          </Button>
        </div>
      )}
      {state === 'review' && recorder.recording && rating !== 'rating' && (
        <>
          <audio controls src={recorder.recording.url} className="w-full" />
          {rating === 'failed' && <p role="alert">I could not rate that: {error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={rate} className={`${pill} bg-mode-strong text-on-mode-strong hover:bg-mode-strong/90`}>
              {rating === 'failed' ? 'Try again' : 'Rate my answer'}
            </Button>
            {rating === 'failed' && (
              <Button variant="outline" onClick={recorder.reset} className={`${pill} border-2 border-foreground/20 bg-card`}>
                <RotateCcw className="size-4" aria-hidden /> Record again
              </Button>
            )}
          </div>
        </>
      )}
      {rating === 'rating' && (
        <p role="status" className="flex items-center gap-2 font-semibold">
          <Loader2 className="size-5 animate-spin" aria-hidden /> Earnest is weighing your answer...
        </p>
      )}
    </div>
  )
}

// After a speech the backend raises Earnest's hand (and the robot's). Calling on it
// runs one web search and shows a question about a claim from the speech, with its source.
export function QuestionCard({ sessionId, mode }: { sessionId: string; mode: ModeId }) {
  const copy = COPY[mode] ?? COPY.presentation
  const [phase, setPhase] = useState<Phase>('waiting')
  const [asked, setAsked] = useState<AudienceQuestion | null>(null)
  const [error, setError] = useState<string | null>(null)

  const take = async () => {
    setPhase('asking')
    setError(null)
    try {
      const result = await askQuestion(sessionId)
      setAsked(result)
      setPhase('asked') // shown as text; read aloud only on request ("Hear it")
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setPhase('failed')
    }
  }

  return (
    <section aria-labelledby="question-heading" className="flex flex-col gap-3 rounded-3xl border-2 border-mode bg-mode-soft p-5">
      <h2 id="question-heading" className="text-xl font-semibold">
        {copy.heading}
      </h2>

      {phase === 'waiting' && <TakeQuestionButton onTake={take} />}

      {phase === 'asking' && (
        <p role="status" className="flex items-center gap-2 font-semibold">
          <Loader2 className="size-5 animate-spin" aria-hidden /> {copy.working}
        </p>
      )}

      {phase === 'failed' && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p>Earnest lost the thread: {error}</p>
          <Button variant="outline" onClick={take} className="h-10 rounded-full border-2 border-foreground/20 bg-card px-5 font-semibold">
            Try again
          </Button>
        </div>
      )}

      {phase === 'asked' && asked && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3">
          <blockquote className="font-heading text-lg">&ldquo;{asked.question}&rdquo;</blockquote>
          <p className="text-sm text-muted-foreground">
            {copy.about}: {asked.claim}
          </p>
          {asked.source && (
            <a
              href={asked.source.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-2 rounded-2xl bg-card p-3 text-sm hover:bg-card/80"
            >
              <ExternalLink className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <span className="font-semibold">{asked.source.title}</span>
                <span className="block text-muted-foreground">{asked.source.snippet}</span>
              </span>
            </a>
          )}
          <Button variant="outline" onClick={() => speak(asked.question)} className="h-10 gap-2 self-start rounded-full border-2 border-foreground/20 bg-card px-5 font-semibold">
            <Volume2 className="size-4" aria-hidden /> Hear it
          </Button>
          <AnswerBox sessionId={sessionId} asked={asked} copy={copy} />
        </motion.div>
      )}
    </section>
  )
}
