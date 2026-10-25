import type { AlertDetail, AlertValue } from '@/types'

// Friendly toast copy for each alert kind (RUBRIC.md: toasts follow the 12 s rule).
export const ALERT_MESSAGE: Record<AlertValue, string> = {
  posture: 'Stand tall and settle your shoulders',
  hands: 'Let your hands show',
  eye_contact: 'Look at the camera',
  too_quiet: 'A little louder, please',
  too_fast: 'Slow down a touch',
  filler: 'Try a pause instead of a filler',
}

// More specific copy when the alert says which behaviour it was.
export const ALERT_DETAIL_MESSAGE: Record<AlertDetail, string> = {
  slouch: 'Stand tall and settle your shoulders',
  sway: 'Plant your feet and stay steady',
  pockets: 'Take your hands out of your pockets',
  fidget: 'Let your hands rest between gestures',
}

export const ALERT_VALUES = Object.keys(ALERT_MESSAGE) as AlertValue[]

/** At most one toast of each alert kind every 12 seconds. */
export const TOAST_COOLDOWN_MS = 12_000
export const TOAST_VISIBLE_MS = 4_000
