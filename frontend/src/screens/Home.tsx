import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { AlertToaster } from '@/components/AlertToaster'
import { ComingSoonBadge } from '@/components/ComingSoonBadge'
import { DevEventTools } from '@/components/DevEventTools'
import { DevMoodSwitcher } from '@/components/DevMoodSwitcher'
import { Mascot } from '@/components/Mascot'
import { ModeCard } from '@/components/ModeCard'
import { PermissionPrompt, type PermissionState } from '@/components/PermissionPrompt'
import { TakeQuestionButton } from '@/components/TakeQuestionButton'
import { features } from '@/features'
import { useLiveEvents } from '@/hooks/useLiveEvents'
import { useSpeaker } from '@/hooks/useSpeaker'
import { liveMood } from '@/lib/mood'
import { MODES } from '@/modes'
import type { Mood } from '@/types'

const GREETING: Record<PermissionState, string> = {
  idle: "Hi, I'm Earnest! Pick something to practice and I'll be your audience.",
  asking: "Take your time. I'll wait right here.",
  granted: "Wonderful, I can hear you. Pick something to practice!",
  denied: "That's okay. You can still look around.",
  unavailable: "Hmm, I can't reach the microphone from this page.",
}

const PERMISSION_MOOD: Record<PermissionState, Mood> = {
  idle: 'idle',
  asking: 'thinking',
  granted: 'happy',
  denied: 'confused',
  unavailable: 'confused',
}

export default function Home() {
  const [permission, setPermission] = useState<PermissionState>('idle')
  const [hoveringCard, setHoveringCard] = useState(false)
  const [override, setOverride] = useState<Mood | null>(null)

  const [speaker, setSpeaker] = useSpeaker()
  const { state, handRaised, toasts, send, dismissToast } = useLiveEvents()

  // Dev override, then live events (state maps straight to a mood, hand: raise to handRaised),
  // then the frontend-only reactions to hovering and the permission prompt.
  const derived: Mood = hoveringCard ? 'listening' : PERMISSION_MOOD[permission]
  const mood = override ?? liveMood(state, handRaised) ?? derived
  const takeQuestion = () => send({ type: 'hand', value: 'lower' })

  return (
    <div className="min-h-dvh bg-warm pb-32 text-plum">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
        <header className="flex flex-col items-center gap-2 text-center md:flex-row md:gap-8 md:text-left">
          <Mascot mood={mood} onClick={handRaised ? takeQuestion : undefined} className="w-48 shrink-0 sm:w-60 md:w-64" />
          <div className="flex flex-col items-center gap-3 md:items-start">
            <p className="font-heading text-sm font-medium uppercase tracking-widest text-plum/60">Speech coach</p>
            <motion.div
              key={GREETING[permission]}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative rounded-3xl bg-white px-5 py-4 shadow-[0_6px_0_0_rgba(43,33,64,0.08)]"
            >
              <h1 className="text-2xl leading-snug font-semibold sm:text-3xl">{GREETING[permission]}</h1>
            </motion.div>
            {handRaised && <TakeQuestionButton onTake={takeQuestion} />}
            <div className="flex w-full max-w-sm flex-col gap-1.5 text-left">
              <label htmlFor="speaker" className="font-semibold">
                What should I call you?
              </label>
              <input
                id="speaker"
                type="text"
                value={speaker}
                onChange={(e) => setSpeaker(e.target.value)}
                placeholder="Your name"
                autoComplete="given-name"
                className="h-11 rounded-2xl border-2 border-plum/15 bg-white px-4 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
              />
              <p className="text-sm text-muted-foreground">I use your name to keep your practice history.</p>
            </div>
          </div>
        </header>

        <section aria-labelledby="modes-heading" className="flex flex-col gap-4">
          <h2 id="modes-heading" className="text-xl font-semibold">
            What do you want to practice?
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MODES.map((mode) => (
              <li key={mode.id}>
                <ModeCard mode={mode} enabled={features.modes[mode.id]} onHover={setHoveringCard} />
              </li>
            ))}
          </ul>
          {features.history ? (
            <Link
              to="/history"
              className="rounded-3xl border-2 border-plum/10 bg-white p-4 font-semibold hover:border-plum/30 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              See your progress
            </Link>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-3xl border-2 border-dashed border-plum/15 p-4" aria-disabled="true">
              <span className="font-semibold text-plum/70">Your progress over time</span>
              <ComingSoonBadge />
            </div>
          )}
        </section>

        <PermissionPrompt onChange={setPermission} />
      </main>
      <AlertToaster toasts={toasts} onDismiss={dismissToast} />
      <DevEventTools send={send} speaker={speaker} />
      <DevMoodSwitcher value={override} onChange={setOverride} />
    </div>
  )
}
