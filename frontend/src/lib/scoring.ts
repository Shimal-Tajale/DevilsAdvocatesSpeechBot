import type { CategoryId, CriterionId, Scores } from '@/types'

// Labels and colours for the 0-10 scale in RUBRIC.md. No red: coral is reserved for alerts.
export type ScoreLabel = 'Nailed it' | 'Getting there' | 'Focus here'

export function scoreLabel(score: number): ScoreLabel {
  if (score >= 8) return 'Nailed it'
  if (score >= 5) return 'Getting there'
  return 'Focus here'
}

export const LABEL_COLOR: Record<ScoreLabel, string> = {
  'Nailed it': 'bg-mint',
  'Getting there': 'bg-butter',
  'Focus here': 'bg-lavender',
}

export const CATEGORY_LABEL: Record<CategoryId | 'confidence', string> = {
  structure: 'Structure',
  clarity: 'Clarity',
  delivery: 'Delivery',
  body_language: 'Body language',
  persuasion: 'Persuasion',
  confidence: 'Confidence score',
}

export const CATEGORY_ORDER: (CategoryId | 'confidence')[] = [
  'structure',
  'clarity',
  'delivery',
  'body_language',
  'persuasion',
  'confidence',
]

export const CRITERION_LABEL: Record<CriterionId, string> = {
  filler_words: 'Filler words',
  confident_language: 'Confident language',
  relevance: 'Relevance',
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

/** Category scores that are present, in display order (body_language may be missing). */
export function presentScores(scores: Scores): { id: CategoryId | 'confidence'; score: number }[] {
  return CATEGORY_ORDER.flatMap((id) => {
    const score = scores[id]
    return typeof score === 'number' ? [{ id, score }] : []
  })
}
