import { motion } from 'framer-motion'
import { ExternalLink, Loader2, Volume2 } from 'lucide-react'
import { useState } from 'react'
import { askQuestion } from '@/api'
import { TakeQuestionButton } from '@/components/TakeQuestionButton'
import { Button } from '@/components/ui/button'
import type { AudienceQuestion } from '@/types'

// The browser's voice: the design doc's text-to-speech fallback.
function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
}

type Phase = 'waiting' | 'asking' | 'asked' | 'failed'

// After a speech the backend raises Earnest's hand (and the robot's). Calling on it
// runs one web search and shows a question about a claim from the speech, with its source.
export function QuestionCard({ sessionId }: { sessionId: string }) {
  const [phase, setPhase] = useState<Phase>('waiting')
  const [asked, setAsked] = useState<AudienceQuestion | null>(null)
  const [error, setError] = useState<string | null>(null)

  const take = async () => {
    setPhase('asking')
    setError(null)
    try {
      const result = await askQuestion(sessionId)
      setAsked(result)
      setPhase('asked')
      speak(result.question)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setPhase('failed')
    }
  }

  return (
    <section aria-labelledby="question-heading" className="flex flex-col gap-3 rounded-3xl border-2 border-mode bg-mode-soft p-5">
      <h2 id="question-heading" className="text-xl font-semibold">
        A question from the audience
      </h2>

      {phase === 'waiting' && <TakeQuestionButton onTake={take} />}

      {phase === 'asking' && (
        <p role="status" className="flex items-center gap-2 font-semibold">
          <Loader2 className="size-5 animate-spin" aria-hidden /> Earnest is checking one of your claims...
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
          <p className="text-sm text-muted-foreground">About: {asked.claim}</p>
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
            <Volume2 className="size-4" aria-hidden /> Hear it again
          </Button>
        </motion.div>
      )}
    </section>
  )
}
