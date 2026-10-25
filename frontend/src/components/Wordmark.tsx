import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'

// The "All Ears" logo, text only: the two l's lean outward like bunny ears and
// wiggle when you hover over the name.
export function Wordmark({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion()
  const ear = 'inline-block origin-bottom text-[#7C5CE0] dark:text-lavender'
  const wiggle = (tilt: number) =>
    reduceMotion ? undefined : { rotate: [tilt, tilt - 8, tilt + 6, tilt - 3, tilt], transition: { duration: 0.6 } }

  return (
    <span className={cn('inline-flex items-baseline font-heading font-bold leading-none tracking-tight', className)}>
      <span className="sr-only">All Ears</span>
      <span aria-hidden className="inline-flex items-baseline">
        <span>A</span>
        <motion.span className={ear} style={{ rotate: -10 }} whileHover={wiggle(-10)}>
          l
        </motion.span>
        <motion.span className={cn(ear, '-ml-px')} style={{ rotate: 10 }} whileHover={wiggle(10)}>
          l
        </motion.span>
        <span className="ml-[0.28em]">Ears</span>
      </span>
    </span>
  )
}
