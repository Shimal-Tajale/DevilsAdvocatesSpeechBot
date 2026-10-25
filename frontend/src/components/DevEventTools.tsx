import { Link } from 'react-router-dom'
import { ALERT_VALUES } from '@/lib/alerts'
import { DevRecordTest } from './DevRecordTest'
import type { EventsMessage, StateValue } from '@/types'

interface DevEventToolsProps {
  send: (message: EventsMessage) => void
  speaker: string
}

const STATES: StateValue[] = ['idle', 'listening', 'thinking', 'speaking']

// Development-only: sends events over the same bus the backend uses, so you can see
// toasts, state moods and the Take question button. Renders nothing in production builds.
export function DevEventTools({ send, speaker }: DevEventToolsProps) {
  if (!import.meta.env.DEV) return null
  const chip =
    'rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold text-warm transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lavender'
  return (
    <div
      role="group"
      aria-label="Developer event tools"
      className="fixed inset-x-2 bottom-24 z-50 mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-1.5 rounded-3xl bg-plum/95 p-2 shadow-lg backdrop-blur sm:bottom-20"
    >
      <span className="px-2 text-xs font-semibold uppercase tracking-wide text-warm/60">Dev events</span>
      {STATES.map((value) => (
        <button key={value} type="button" className={chip} onClick={() => send({ type: 'state', value })}>
          state: {value}
        </button>
      ))}
      <button type="button" className={chip} onClick={() => send({ type: 'hand', value: 'raise' })}>
        hand: raise
      </button>
      <button type="button" className={chip} onClick={() => send({ type: 'hand', value: 'lower' })}>
        hand: lower
      </button>
      {ALERT_VALUES.map((value) => (
        <button key={value} type="button" className={chip} onClick={() => send({ type: 'alert', value })}>
          alert: {value}
        </button>
      ))}
      <DevRecordTest speaker={speaker} />
      <Link to="/results" className={chip}>
        open results (mock)
      </Link>
    </div>
  )
}
