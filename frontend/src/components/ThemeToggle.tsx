import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-foreground/15 bg-card text-foreground transition-colors hover:border-foreground/30 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {dark ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
    </button>
  )
}
