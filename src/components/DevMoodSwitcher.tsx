import { MOODS, type Mood } from '@/types'

interface DevMoodSwitcherProps {
  value: Mood | null
  onChange: (mood: Mood | null) => void
}

// Development-only: click through every mascot mood. Renders nothing in production builds.
export function DevMoodSwitcher({ value, onChange }: DevMoodSwitcherProps) {
  if (!import.meta.env.DEV) return null
  const chip = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lavender ${
      active ? 'bg-butter text-plum' : 'bg-white/10 text-warm hover:bg-white/20'
    }`
  return (
    <div
      role="group"
      aria-label="Developer mood switcher"
      className="fixed inset-x-2 bottom-2 z-50 mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-1.5 rounded-3xl bg-plum/95 p-2 shadow-lg backdrop-blur"
    >
      <span className="px-2 text-xs font-semibold uppercase tracking-wide text-warm/60">Dev mood</span>
      <button type="button" className={chip(value === null)} onClick={() => onChange(null)}>
        auto
      </button>
      {MOODS.map((m) => (
        <button key={m} type="button" className={chip(value === m)} aria-pressed={value === m} onClick={() => onChange(m)}>
          {m}
        </button>
      ))}
    </div>
  )
}
