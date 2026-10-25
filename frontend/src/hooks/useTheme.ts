import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'speech-coach.theme'
const listeners = new Set<() => void>()

// index.html sets the initial class before the page paints (saved choice, else the system setting).
const current = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // storage can be blocked; the choice still holds for this visit
  }
  listeners.forEach((listener) => listener())
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => 'light' as Theme)
  return { theme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') }
}
