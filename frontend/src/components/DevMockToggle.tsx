import type { MockVariant } from '@/api'

interface DevMockToggleProps {
  value: MockVariant
  onChange: (variant: MockVariant) => void
}

const OPTIONS: { id: MockVariant; label: string }[] = [
  { id: 'full', label: 'all 13 criteria' },
  { id: 'no_camera', label: 'no camera or script' },
  { id: 'scores_only', label: 'scores only (no criteria)' },
]

// Development-only: switch between the mock Results. Renders nothing in production builds.
export function DevMockToggle({ value, onChange }: DevMockToggleProps) {
  if (!import.meta.env.DEV) return null
  return (
    <div
      role="group"
      aria-label="Developer mock results switcher"
      className="fixed inset-x-2 bottom-2 z-50 mx-auto flex max-w-xl flex-wrap items-center justify-center gap-1.5 rounded-3xl bg-plum/95 p-2 shadow-lg backdrop-blur"
    >
      <span className="px-2 text-xs font-semibold uppercase tracking-wide text-warm/60">Dev mock</span>
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lavender ${
            value === option.id ? 'bg-butter text-plum' : 'bg-white/10 text-warm hover:bg-white/20'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
