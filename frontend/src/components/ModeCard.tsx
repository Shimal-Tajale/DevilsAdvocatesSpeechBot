import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ModeConfig } from '@/modes'
import { ComingSoonBadge } from './ComingSoonBadge'

interface ModeCardProps {
  mode: ModeConfig
  enabled: boolean
  onHover?: (hovering: boolean) => void
}

const base =
  'group relative flex h-full flex-col gap-3 rounded-3xl border-2 border-plum/10 bg-white p-5 text-left transition-shadow'

export function ModeCard({ mode, enabled, onHover }: ModeCardProps) {
  const { Icon } = mode
  const body = (
    <>
      <span className={`flex size-12 items-center justify-center rounded-2xl text-plum ${mode.accent}`}>
        <Icon className="size-6" aria-hidden />
      </span>
      <h3 className="text-xl font-semibold">{mode.title}</h3>
      <p className="text-muted-foreground">{mode.description}</p>
      <span className="mt-auto pt-2">
        {enabled ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-plum">
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
      <div className={`${base} opacity-80`} aria-disabled="true">
        {body}
      </div>
    )
  }

  return (
    <Link
      to={mode.path}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      onFocus={() => onHover?.(true)}
      onBlur={() => onHover?.(false)}
      className={`${base} hover:border-plum/30 hover:shadow-[0_8px_0_0_rgba(43,33,64,0.12)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring`}
    >
      {body}
    </Link>
  )
}
