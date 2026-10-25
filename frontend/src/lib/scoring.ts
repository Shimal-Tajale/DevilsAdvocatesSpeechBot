import type { CategoryId, CriterionId, Scores } from '@/types'

// Labels for the 0-10 scale in RUBRIC.md.
export type ScoreLabel = 'Nailed it' | 'Getting there' | 'Focus here'

export function scoreLabel(score: number): ScoreLabel {
  if (score >= 8) return 'Nailed it'
  if (score >= 5) return 'Getting there'
  return 'Focus here'
}

const RED = '#E5484D' // score 0
const BLUE = '#2F6BFF' // score 10

/**
 * Bar color for a 0-10 score: red at 0, blue at 10, mixed in OKLCH so the middle is a
 * vivid purple instead of gray. Color is never the only signal; the number and label always show.
 */
export function scoreColor(score: number): string {
  const blue = Math.round(Math.min(10, Math.max(0, score)) * 10)
  return `color-mix(in oklch, ${BLUE} ${blue}%, ${RED})`
}

export const CATEGORY_LABEL: Record<CategoryId | 'confidence', string> = {
  structure: 'Structure',
  clarity: 'Clarity',
  delivery: 'Delivery',
  body_language: 'Body language',
  persuasion: 'Persuasion',
  confidence: 'Confidence score',
}

// The five scored categories and the criteria each one averages (RUBRIC.md).
export const CATEGORY_CRITERIA: Record<CategoryId, CriterionId[]> = {
  structure: ['structure', 'timing', 'script_coverage'],
  clarity: ['filler_words', 'confident_language', 'relevance'],
  delivery: ['pace', 'pauses', 'volume', 'vocal_variety'],
  body_language: ['eye_contact', 'posture'],
  persuasion: ['evidence'],
}

export const CATEGORY_ORDER = Object.keys(CATEGORY_CRITERIA) as CategoryId[]

export const CRITERION_LABEL: Record<CriterionId, string> = {
  filler_words: 'Filler words',
  confident_language: 'Confident language',
  relevance: 'Staying on topic',
  pace: 'Pace',
  pauses: 'Pauses',
  volume: 'Volume',
  vocal_variety: 'Vocal variety',
  structure: 'Structure',
  timing: 'Timing',
  script_coverage: 'Script coverage',
  eye_contact: 'Eye contact',
  posture: 'Posture',
  evidence: 'Evidence',
}

// Why a criterion can be missing from `criteria` (RUBRIC.md: skip it when its input is missing).
export const NOT_SCORED_REASON: Record<CriterionId, string> = {
  filler_words: 'Not scored this time.',
  confident_language: 'Not scored this time.',
  relevance: 'Not scored this time.',
  pace: 'Not scored this time.',
  pauses: 'Not scored this time.',
  volume: 'No microphone level data for this recording.',
  vocal_variety: 'Optional, and not scored this time.',
  structure: 'Not scored this time.',
  timing: 'No target length was set.',
  script_coverage: 'No script was added.',
  eye_contact: 'No camera was used.',
  posture: 'No camera was used.',
  evidence: 'Not scored this time.',
}

/** Average of the numbers present, rounded to one decimal; null when there are none. */
export function average(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
}

/** The category scores that are present (body_language may be missing). */
export function presentScores(scores: Scores): { id: CategoryId; score: number }[] {
  return CATEGORY_ORDER.flatMap((id) => {
    const score = scores[id]
    return typeof score === 'number' ? [{ id, score }] : []
  })
}
