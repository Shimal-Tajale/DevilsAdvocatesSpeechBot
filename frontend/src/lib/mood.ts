import type { Mood, StateValue } from '@/types'

/**
 * The backend's state values are valid mascot moods, so they map straight across.
 * hand: raise puts the mascot in handRaised until hand: lower arrives.
 * confused, bored and happy are frontend-only moods; the backend never sends them.
 */
export function liveMood(state: StateValue | null, handRaised: boolean): Mood | null {
  if (handRaised) return 'handRaised'
  return state
}
