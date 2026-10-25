import { motion, useReducedMotion } from 'framer-motion'

interface ScoreRingProps {
  score: number // 0-100
  color?: string
}

export function ScoreRing({ score, color = '#8FE3C0' }: ScoreRingProps) {
  const reduce = useReducedMotion()
  const radius = 54
  return (
    <div className="relative size-40 shrink-0" role="img" aria-label={`Overall score ${score} out of 100`}>
      <svg viewBox="0 0 128 128" className="size-full -rotate-90">
        <circle cx="64" cy="64" r={radius} fill="none" stroke="currentColor" className="text-foreground/15" strokeWidth="12" />
        <motion.circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          initial={{ pathLength: reduce ? score / 100 : 0 }}
          animate={{ pathLength: score / 100 }}
          transition={{ duration: reduce ? 0 : 1, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-heading text-4xl font-semibold">{score}</span>
        <span className="text-sm text-muted-foreground">out of 100</span>
      </div>
    </div>
  )
}
