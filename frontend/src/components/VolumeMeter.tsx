interface VolumeMeterProps {
  level: number // 0..1
  active: boolean
}

const BARS = 16

// Live input level, so the speaker can see the microphone is working.
export function VolumeMeter({ level, active }: VolumeMeterProps) {
  const lit = active ? Math.round(level * BARS) : 0
  return (
    <div
      role="meter"
      aria-label="Microphone level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((active ? level : 0) * 100)}
      className="flex h-8 items-end justify-center gap-1"
    >
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          className={`w-2 rounded-full transition-colors duration-100 sm:w-2.5 ${i < lit ? 'bg-mode-strong' : 'bg-foreground/15'}`}
          style={{ height: `${40 + (i / BARS) * 60}%` }}
        />
      ))}
    </div>
  )
}
