import { motion, useReducedMotion } from 'framer-motion'
import { LABEL_COLOR, scoreLabel } from '@/lib/scoring'

interface ScoreBarProps {
  name: string
  score: number // 0-10
  detail?: string
  tip?: string
}

// One bar with a friendly label instead of a red number (RUBRIC.md scoring scale).
export function ScoreBar({ name, score, detail, tip }: ScoreBarProps) {
  const reduce = useReducedMotion()
  const label = scoreLabel(score)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">{name}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold text-plum ${LABEL_COLOR[label]}`}>
          {label} <span className="text-plum/60">{score}/10</span>
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-muted" role="presentation">
        <motion.div
          className={`h-full rounded-full ${LABEL_COLOR[label]}`}
          initial={{ width: reduce ? `${score * 10}%` : 0 }}
          animate={{ width: `${score * 10}%` }}
          transition={{ duration: reduce ? 0 : 0.8, ease: 'easeOut' }}
        />
      </div>
      {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
      {tip && <p className="text-sm">Try this: {tip}</p>}
    </div>
  )
}
