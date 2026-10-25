import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ModeConfig } from '@/modes'
import { ComingSoonBadge } from './ComingSoonBadge'

interface ModeCardProps {
  mode: ModeConfig
  enabled: boolean
  onHover?: (hovering: boolean) => void
}

// data-mode gives each card its own theme colors (purple, yellow or green), the same ones the
// session and results screens use for that mode.
const base =
  'group relative flex h-full flex-col gap-3 rounded-3xl border-2 border-mode bg-mode-soft p-5 text-left transition-[box-shadow,transform]'

export function ModeCard({ mode, enabled, onHover }: ModeCardProps) {
  const { Icon } = mode
  const body = (
    <>
      <span className="flex size-12 items-center justify-center rounded-2xl bg-mode text-plum">
        <Icon className="size-6" aria-hidden />
      </span>
      <h3 className="text-xl font-semibold">{mode.title}</h3>
      <p className="text-foreground/75">{mode.description}</p>
      <span className="mt-auto pt-2">
        {enabled ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-mode-strong">
            Start {mode.title.toLowerCase()}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
          </span>
        ) : (
          <ComingSoonBadge />
        )}
      </span>
    </>
  )

  if (!enabled) {
    return (
      <div data-mode={mode.id} className={`${base} border-dashed opacity-80`} aria-disabled="true">
        {body}
      </div>
    )
  }

  return (
    <Link
      to={mode.path}
      data-mode={mode.id}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      onFocus={() => onHover?.(true)}
      onBlur={() => onHover?.(false)}
      className={`${base} hover:-translate-y-0.5 hover:shadow-[0_8px_0_0_var(--mode)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-mode-strong`}
    >
      {body}
    </Link>
  )
}
