import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getHistory } from '@/api'
import { Mascot } from '@/components/Mascot'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useSpeaker } from '@/hooks/useSpeaker'
import { scoreColor } from '@/lib/scoring'
import { MODES } from '@/modes'
import type { Session, SessionResults } from '@/types'

type Recorded = Session & { results: SessionResults }

// GET /history/{speaker}: every session this name has recorded, newest first,
// each linking to its saved report at /results/:session_id.
export default function History() {
  const [speaker] = useSpeaker()
  const name = speaker.trim()
  const [loaded, setLoaded] = useState<{ key: string; sessions?: Recorded[]; error?: string } | null>(null)

  useEffect(() => {
    if (!name) return
    let cancelled = false
    getHistory(name)
      .then((all) => all.filter((s): s is Recorded => s.results !== null).reverse()) // oldest first from the API
      .then((sessions) => !cancelled && setLoaded({ key: name, sessions }))
      .catch((e: Error) => !cancelled && setLoaded({ key: name, error: e.message }))
    return () => {
      cancelled = true
    }
  }, [name])

  const current = loaded?.key === name ? loaded : null
  const sessions = current?.sessions
  const scores = sessions?.map((s) => s.results.feedback.overall) ?? []
  const best = Math.max(...scores)
  const average = Math.round(scores.reduce((a, b) => a + b, 0) / (scores.length || 1))
  // Newest minus oldest: are they getting better?
  const change = scores.length > 1 ? scores[0] - scores[scores.length - 1] : null

  let message: string | null = null
  if (!name) message = 'Tell me your name on the home screen and I will keep your history.'
  else if (current?.error) message = current.error
  else if (!sessions) message = 'Looking through your speeches...'
  else if (sessions.length === 0) message = `No speeches yet, ${name}. Give one and it will show up here.`

  return (
    <div data-mode="presentation" className="page-mode min-h-dvh pb-24 text-foreground">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
        <div className="flex items-center justify-between text-sm font-semibold">
          <Link to="/" className="underline underline-offset-4">
            Back to home
          </Link>
          <ThemeToggle />
        </div>

        <header className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
          <Mascot mood={sessions === undefined && name && !current?.error ? 'thinking' : change !== null && change > 0 ? 'happy' : 'idle'} className="w-32 shrink-0" />
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-semibold">{name ? `${name}'s progress` : 'Your progress'}</h1>
            {message && <p className="text-muted-foreground">{message}</p>}
          </div>
        </header>

        {sessions && sessions.length > 0 && (
          <>
            <dl className="grid grid-cols-3 gap-3">
              {[
                ['Speeches', String(sessions.length)],
                ['Best', String(best)],
                ['Average', String(average)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-3xl border-2 border-foreground/10 bg-card p-4 text-center">
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="font-heading text-3xl font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            {change !== null && (
              <p className="text-center font-semibold">
                {change > 0
                  ? `Up ${change} points since your first speech.`
                  : change < 0
                    ? `Down ${-change} points since your first speech. Keep going!`
                    : 'Same score as your first speech.'}
              </p>
            )}

            <ul className="flex flex-col gap-3">
              {sessions.map((s) => {
                const mode = MODES.find((m) => m.id === s.mode)
                const Icon = mode?.Icon
                const { overall } = s.results.feedback
                const { wpm, fillers } = s.results.metrics
                return (
                  <li key={s.session_id}>
                    <Link
                      to={`/results/${s.session_id}`}
                      className="flex items-center gap-4 rounded-3xl border-2 border-foreground/10 bg-card p-4 hover:border-foreground/30 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {Icon && <Icon aria-hidden className="size-6 shrink-0 text-foreground/60" />}
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-semibold">{s.topic}</span>
                        <span className="text-sm text-muted-foreground">
                          {mode?.title ?? s.mode} · {wpm} wpm · {fillers} {fillers === 1 ? 'filler' : 'fillers'}
                        </span>
                      </div>
                      <span
                        className="flex size-12 shrink-0 items-center justify-center rounded-full font-heading text-lg font-semibold ring-4"
                        style={{ '--tw-ring-color': scoreColor(overall / 10) } as React.CSSProperties}
                        aria-label={`Overall ${overall} out of 100`}
                      >
                        {overall}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </main>
    </div>
  )
}
