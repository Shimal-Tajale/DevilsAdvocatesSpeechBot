import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { getSession, postSpeech } from '@/api'
import { Mascot } from '@/components/Mascot'
import { ScoreBar } from '@/components/ScoreBar'
import { ScoreRing } from '@/components/ScoreRing'
import { features } from '@/features'
import { CATEGORY_LABEL, CATEGORY_ORDER, CRITERION_LABEL, presentScores, scoreLabel } from '@/lib/scoring'
import type { CategoryId, SessionResults, SpeechResponse } from '@/types'

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
  // Results come from the router state (right after POST /speech), or from the saved
  // session at /results/:session_id, or, with mocks on, from the mock backend at /results.
  const passed = (location.state as { result?: SpeechResponse } | null)?.result
  const key = session_id ?? 'mock'
  const needsLoad = !passed && (session_id !== undefined || features.useMocks)
  const [loaded, setLoaded] = useState<{ key: string; result?: SessionResults; error?: string } | null>(null)

  useEffect(() => {
    if (!needsLoad) return
    let cancelled = false
    const load = session_id
      ? getSession(session_id).then((s) =>
          s.results ? { result: s.results } : { error: 'This session has no recording yet.' },
        )
      : postSpeech(new Blob()).then((result) => ({ result }))
    load
      .then((v) => !cancelled && setLoaded({ key, ...v }))
      .catch((e: Error) => !cancelled && setLoaded({ key, error: e.message }))
    return () => {
      cancelled = true
    }
  }, [needsLoad, session_id, key])

  const current = loaded?.key === key ? loaded : null
  const result: (SessionResults & Partial<SpeechResponse>) | null = passed ?? current?.result ?? null
  const error = current?.error
  const canFetchMock = needsLoad && !error

  const criteriaByCategory = useMemo(() => {
    const groups = new Map<CategoryId, NonNullable<SpeechResponse['feedback']['criteria']>>()
    for (const c of result?.feedback.criteria ?? []) groups.set(c.category, [...(groups.get(c.category) ?? []), c])
    return groups
  }, [result])

  if (!result) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center gap-4 p-6 text-center text-plum">
        <Mascot mood={canFetchMock ? 'thinking' : error ? 'confused' : 'idle'} className="w-40" />
        <h1 className="text-2xl font-semibold">
          {canFetchMock ? 'Earnest is reading your speech...' : (error ?? 'No results to show yet')}
        </h1>
        {!canFetchMock && (
          <Link to="/" className="font-semibold underline underline-offset-4">
            Back to home
          </Link>
        )}
      </main>
    )
  }

  const { feedback, metrics, transcript } = result
  const scores = presentScores(feedback.scores)
  const criteriaGroups = CATEGORY_ORDER.filter((id): id is CategoryId => id !== 'confidence' && criteriaByCategory.has(id))

  return (
    <div className="min-h-dvh bg-warm pb-16 text-plum">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
        <header className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
          <Mascot mood={feedback.overall >= 70 ? 'happy' : 'idle'} className="w-40 shrink-0" />
          <div className="flex flex-col items-center gap-3 sm:items-start">
            <h1 className="text-3xl font-semibold">Your results</h1>
            <p className="rounded-3xl bg-white px-5 py-3 text-lg shadow-[0_6px_0_0_rgba(43,33,64,0.08)]">{feedback.robot_line}</p>
          </div>
          <div className="sm:ml-auto">
            <ScoreRing score={feedback.overall} />
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

        <section aria-labelledby="scores-heading" className="flex flex-col gap-4 rounded-3xl bg-white p-5">
          <h2 id="scores-heading" className="text-xl font-semibold">
            Your scores
          </h2>
          {scores.map(({ id, score }) => (
            <ScoreBar key={id} name={CATEGORY_LABEL[id]} score={score} />
          ))}
          <p className="text-sm text-muted-foreground">
            The confidence score is built from your measured delivery, body language and confident language.
          </p>
        </section>

        {feedback.criteria && (
          <section aria-labelledby="criteria-heading" className="flex flex-col gap-6 rounded-3xl bg-white p-5">
            <h2 id="criteria-heading" className="text-xl font-semibold">
              The details
            </h2>
            {criteriaGroups.map((category) => (
              <div key={category} className="flex flex-col gap-4">
                <h3 className="text-lg font-semibold">{CATEGORY_LABEL[category]}</h3>
                {criteriaByCategory.get(category)!.map((c) => (
                  <ScoreBar key={c.id} name={CRITERION_LABEL[c.id]} score={c.score} detail={c.detail} tip={c.tip} />
                ))}
              </div>
            ))}
          </section>
        )}

        <section aria-labelledby="numbers-heading" className="flex flex-col gap-3 rounded-3xl bg-white p-5">
          <h2 id="numbers-heading" className="text-xl font-semibold">
            By the numbers
          </h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Words per minute', metrics.wpm],
              ['Fillers', metrics.fillers],
              ['Long pauses', metrics.pauses],
              ['Speaking time', `${metrics.speaking_time}s`],
              // from the browser's vision stats, only when they were sent
              ...(typeof metrics.eye_contact_pct === 'number' ? [['Facing the camera', `${Math.round(metrics.eye_contact_pct)}%`]] : []),
              ...(typeof metrics.posture_alerts === 'number' ? [['Posture alerts', metrics.posture_alerts]] : []),
            ].map(([name, value]) => (
              <div key={name} className="rounded-2xl bg-muted p-3">
                <dt className="text-sm text-muted-foreground">{name}</dt>
                <dd className="font-heading text-2xl font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="transcript-heading" className="flex flex-col gap-3 rounded-3xl bg-white p-5">
          <h2 id="transcript-heading" className="text-xl font-semibold">
            Transcript
          </h2>
          <p className="leading-relaxed">{highlightFillers(transcript, metrics.filler_list)}</p>
          <p className="text-sm text-muted-foreground">
            Overall: {scoreLabel(feedback.overall / 10)}. Filler words are highlighted.
          </p>
        </section>

        <Link to="/" className="self-center font-semibold underline underline-offset-4">
          Back to home
        </Link>
      </main>
    </div>
  )
}
