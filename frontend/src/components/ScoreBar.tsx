import { motion, useReducedMotion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import { scoreColor, scoreLabel } from '@/lib/scoring'

export function LabelChip({ score }: { score: number }) {
  const label = scoreLabel(score)
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/20 bg-card px-2.5 py-0.5 text-sm font-semibold whitespace-nowrap text-foreground">
      <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: scoreColor(score) }} />
      {label}
    </span>
  )
}

interface ScoreBarProps {
  name: string
  score: number // 0-10
  detail?: string
  tip?: string // revealed on click
}

// One criterion: name, "6/10", a label, a bar that runs from red (0) to blue (10), the detail
// line, and the tip behind a button. The bar animates from 0 once when it mounts.
export function ScoreBar({ name, score, detail, tip }: ScoreBarProps) {
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(false)
  const tipId = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="font-semibold">{name}</span>
        <span className="flex items-center gap-2">
          <span className="font-heading font-semibold tabular-nums">{score}/10</span>
          <LabelChip score={score} />
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${name} score`}
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={score}
        aria-valuetext={`${score} out of 10, ${scoreLabel(score)}`}
        className="h-3.5 overflow-hidden rounded-full bg-foreground/10 ring-1 ring-foreground/25"
      >
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: scoreColor(score) }}
          initial={{ width: reduce ? `${score * 10}%` : 0 }}
          animate={{ width: `${score * 10}%` }}
          transition={{ duration: reduce ? 0 : 0.8, ease: 'easeOut' }}
        />
      </div>
      {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
      {tip && (
        <div>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={tipId}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {open ? 'Hide tip' : 'Show tip'}
            <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {open && (
            <p id={tipId} className="mt-1 rounded-2xl bg-muted px-3 py-2 text-sm">
              Try this: {tip}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// A criterion that is missing from `criteria`: gray, with a short reason.
export function NotScoredRow({ name, reason }: { name: string; reason: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-2xl bg-muted px-3 py-2 text-muted-foreground">
      <span className="font-semibold">{name}</span>
      <span className="text-sm">
        <span className="font-semibold">Not scored.</span> {reason}
      </span>
    </div>
  )
}
