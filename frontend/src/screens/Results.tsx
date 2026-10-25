import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { getSession, mockResultsByVariant, type MockVariant } from '@/api'
import { DevMockToggle } from '@/components/DevMockToggle'
import { Mascot } from '@/components/Mascot'
import { QuestionCard } from '@/components/QuestionCard'
import { LabelChip, NotScoredRow, ScoreBar } from '@/components/ScoreBar'
import { ScoreRing } from '@/components/ScoreRing'
import { features } from '@/features'
import {
  CATEGORY_CRITERIA,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  CRITERION_LABEL,
  NOT_SCORED_REASON,
  average,
  presentScores,
  scoreColor,
} from '@/lib/scoring'
import { ThemeToggle } from '@/components/ThemeToggle'
import type { CriterionScore, ModeId, SessionResults, SpeechResponse } from '@/types'

function highlightFillers(transcript: string, fillers: string[]) {
  const unique = [...new Set(fillers.map((f) => f.toLowerCase()))]
  if (unique.length === 0) return transcript
  const pattern = new RegExp(`\\b(${unique.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi')
  return transcript.split(pattern).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded bg-butter px-1 text-plum">
        {part}
      </mark>
    ) : (
      part
    ),
  )
}

export default function Results() {
  const location = useLocation()
  const { session_id } = useParams()
  // Results come from the router state (right after POST /speech), or from the saved session at
  // /results/:session_id. At /results with no session, development builds (and mock mode) show a mock.
  const navState = location.state as { result?: SpeechResponse; mode?: ModeId } | null
  const passed = navState?.result
  const [variant, setVariant] = useState<MockVariant>('full')
  const showMock = !passed && session_id === undefined && (features.useMocks || import.meta.env.DEV)
  const needsLoad = !passed && session_id !== undefined
  const [loaded, setLoaded] = useState<{ key: string; result?: SessionResults; mode?: ModeId; error?: string } | null>(null)

  useEffect(() => {
    if (!needsLoad) return
    let cancelled = false
    getSession(session_id)
      .then((s) => (s.results ? { result: s.results, mode: s.mode } : { error: 'This session has no recording yet.' }))
      .then((v) => !cancelled && setLoaded({ key: session_id, ...v }))
      .catch((e: Error) => !cancelled && setLoaded({ key: session_id, error: e.message }))
    return () => {
      cancelled = true
    }
  }, [needsLoad, session_id])

  const current = loaded?.key === session_id ? loaded : null
  const result: (SessionResults & Partial<SpeechResponse>) | null =
    passed ?? current?.result ?? (showMock ? mockResultsByVariant[variant] : null)
  const error = current?.error
  const mode: ModeId = navState?.mode ?? current?.mode ?? 'presentation' // themes the page like the session was
  const loading = needsLoad && !error

  if (!result) {
    return (
      <main data-mode={mode} className="page-mode mx-auto flex min-h-dvh max-w-none flex-col items-center justify-center gap-4 p-6 text-center text-foreground">
        <Mascot mood={loading ? 'thinking' : 'idle'} className="w-40" />
        <h1 className="text-2xl font-semibold">
          {loading ? 'Earnest is reading your speech...' : (error ?? 'No results to show yet')}
        </h1>
        {!loading && (
          <Link to="/" className="font-semibold underline underline-offset-4">
            Back to home
          </Link>
        )}
      </main>
    )
  }

  const { feedback, metrics, transcript } = result
  const criteria = feedback.criteria
  const confidence = feedback.scores.confidence

  // The camera's tally, only when the browser sent vision stats. Older sessions have
  // posture/hands totals but not which behaviour each alert was.
  const bodyRows: [string, string | number][] =
    typeof metrics.posture_alerts === 'number'
      ? [
          ...(typeof metrics.eye_contact_pct === 'number'
            ? [['Facing the camera', `${Math.round(metrics.eye_contact_pct)}%`] as [string, string]]
            : []),
          ['Looked away', metrics.eye_contact_alerts ?? 0],
          ...(typeof metrics.slouch_alerts === 'number'
            ? ([['Slouching', metrics.slouch_alerts], ['Swaying', metrics.sway_alerts ?? 0]] as [string, number][])
            : ([['Posture alerts', metrics.posture_alerts]] as [string, number][])),
          ...(typeof metrics.pocket_alerts === 'number'
            ? ([['Hands in pockets', metrics.pocket_alerts], ['Fidgeting', metrics.fidget_alerts ?? 0]] as [string, number][])
            : ([['Hand alerts', metrics.hands_alerts ?? 0]] as [string, number][])),
        ]
      : []

  return (
    <div data-mode={mode} className="page-mode min-h-dvh pb-24 text-foreground">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
        <div className="flex items-center justify-between text-sm font-semibold">
          <Link to="/" className="underline underline-offset-4">
            Back to home
          </Link>
          <ThemeToggle />
        </div>

        <header className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
          <Mascot mood={feedback.overall >= 70 ? 'happy' : 'idle'} className="w-36 shrink-0" />
          <h1 className="text-3xl font-semibold">Your results</h1>
          <div className="flex flex-col items-center gap-2 sm:ml-auto">
            <ScoreRing score={feedback.overall} color={scoreColor(feedback.overall / 10)} />
            <LabelChip score={feedback.overall / 10} />
            {typeof confidence === 'number' && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-0.5 text-xs font-semibold ring-1 ring-foreground/20"
                title="Built from your measured delivery, body language and confident language"
              >
                <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: scoreColor(confidence) }} />
                Confidence score {confidence}/10
              </span>
            )}
          </div>
        </header>

        {result.session_id && result.saved === false && (
          <p role="status" className="rounded-2xl bg-butter/50 px-4 py-3 text-center">
            These results could not be saved to your history, but they are all here.
          </p>
        )}

        <section aria-labelledby="strengths-heading" className="flex flex-col gap-3 rounded-3xl bg-mint/40 p-5">
          <h2 id="strengths-heading" className="text-xl font-semibold">
            What went well
          </h2>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {feedback.strengths.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="fixes-heading" className="flex flex-col gap-3 rounded-3xl bg-butter/40 p-5">
          <h2 id="fixes-heading" className="text-xl font-semibold">
            What to try next
          </h2>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {feedback.fixes.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>

        <figure className="rounded-3xl border-l-8 border-mode bg-mode-soft px-5 py-4">
          <blockquote className="font-heading text-lg">&ldquo;{feedback.robot_line}&rdquo;</blockquote>
          <figcaption className="mt-1 text-sm text-muted-foreground">Earnest</figcaption>
        </figure>

        {features.mascotQuestions && session_id && <QuestionCard sessionId={session_id} />}

        <section aria-labelledby="scores-heading" className="flex flex-col gap-6 rounded-3xl border-2 border-mode bg-card p-5">
          <h2 id="scores-heading" className="text-xl font-semibold">
            Your scores
          </h2>
          {criteria ? (
            CATEGORY_ORDER.map((category) => {
              const rows = CATEGORY_CRITERIA[category].map((id) => ({ id, found: criteria.find((c) => c.id === id) }))
              const scored = rows.flatMap((r): CriterionScore[] => (r.found ? [r.found] : []))
              const avg = average(scored.map((c) => c.score)) // missing criteria are ignored
              return (
                <div key={category} className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-mode pb-2">
                    <h3 className="text-lg font-semibold text-mode-strong">{CATEGORY_LABEL[category]}</h3>
                    {avg === null ? (
                      <span className="text-sm font-semibold text-muted-foreground">Not scored</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="font-heading text-lg font-semibold tabular-nums">{avg}/10</span>
                        <LabelChip score={avg} />
                      </span>
                    )}
                  </div>
                  {rows.map(({ id, found }) =>
                    found ? (
                      <ScoreBar key={id} name={CRITERION_LABEL[id]} score={found.score} detail={found.detail} tip={found.tip} />
                    ) : (
                      <NotScoredRow key={id} name={CRITERION_LABEL[id]} reason={NOT_SCORED_REASON[id]} />
                    ),
                  )}
                </div>
              )
            })
          ) : (
            <div className="flex flex-col gap-4">
              {presentScores(feedback.scores).map(({ id, score }) => (
                <ScoreBar key={id} name={CATEGORY_LABEL[id]} score={score} />
              ))}
              <p className="text-sm text-muted-foreground">Detailed scores are not available for this recording.</p>
            </div>
          )}
        </section>

        <section aria-labelledby="numbers-heading" className="flex flex-col gap-3 rounded-3xl border border-foreground/10 bg-card p-5">
          <h2 id="numbers-heading" className="text-xl font-semibold">
            By the numbers
          </h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Words per minute', metrics.wpm],
              ['Fillers', metrics.fillers],
              ['Long pauses', metrics.pauses],
              ['Speaking time', `${metrics.speaking_time}s`],
            ].map(([name, value]) => (
              <div key={name} className="rounded-2xl bg-muted p-3">
                <dt className="text-sm text-muted-foreground">{name}</dt>
                <dd className="font-heading text-2xl font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {bodyRows.length > 0 && (
          <section aria-labelledby="body-heading" className="flex flex-col gap-3 rounded-3xl border border-foreground/10 bg-card p-5">
            <h2 id="body-heading" className="text-xl font-semibold">
              Body language
            </h2>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {bodyRows.map(([name, value]) => (
                <div key={name} className="rounded-2xl bg-muted p-3">
                  <dt className="text-sm text-muted-foreground">{name}</dt>
                  <dd className="font-heading text-2xl font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-muted-foreground">
              Counted from the camera while you were recording. Each kind of reminder shows at most once every 12 seconds.
            </p>
          </section>
        )}

        <section aria-labelledby="transcript-heading" className="flex flex-col gap-3 rounded-3xl border border-foreground/10 bg-card p-5">
          <h2 id="transcript-heading" className="text-xl font-semibold">
            Transcript
          </h2>
          <p className="leading-relaxed">{highlightFillers(transcript, metrics.filler_list)}</p>
          <p className="text-sm text-muted-foreground">Filler words are highlighted.</p>
        </section>

        <Link to="/" className="self-center font-semibold underline underline-offset-4">
          Back to home
        </Link>
      </main>
      {showMock && <DevMockToggle value={variant} onChange={setVariant} />}
    </div>
  )
}
