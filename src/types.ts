// Keep in sync with the data contracts in CLAUDE.md.

export type Mood =
  | 'idle'
  | 'listening'
  | 'confused'
  | 'bored'
  | 'handRaised'
  | 'speaking'
  | 'happy'
  | 'thinking'

export type CategoryId = 'voice' | 'body' | 'content'

export type CriterionId =
  | 'filler_words'
  | 'pace'
  | 'volume'
  | 'vocal_variety'
  | 'pauses'
  | 'eye_contact'
  | 'posture'
  | 'relevance'
  | 'structure'
  | 'script_coverage'
  | 'confident_language'
  | 'timing'

export interface CategoryScore {
  id: CategoryId
  score: number
}

export interface CriterionScore {
  id: CriterionId
  category: CategoryId
  score: number
  detail: string
  tip: string
}

export type TranscriptFlag = 'filler' | 'hedge'

export interface TranscriptWord {
  start: number // seconds from session start
  text: string
  flag?: TranscriptFlag
}

export interface Results {
  overall: number
  categories: CategoryScore[]
  criteria: CriterionScore[]
  transcript: TranscriptWord[]
  questions: string[]
}

export type IndicatorId = 'filler_words' | 'pace' | 'volume' | 'eye_contact'
export type IndicatorStatus = 'ok' | 'warn' | 'alert'

// WebSocket events
export interface IndicatorEvent {
  type: 'indicator'
  id: IndicatorId
  value: number
  status: IndicatorStatus
}

export interface MoodEvent {
  type: 'mood'
  value: Mood
}

export type LiveEvent = IndicatorEvent | MoodEvent

// Setup payloads
export interface PublicSpeakingSetup {
  topic: string
  targetMinutes: number
  script?: string
}

export interface DebateSetup {
  motion: string
  side: 'for' | 'against'
  difficulty: 'easy' | 'medium' | 'hard'
}

export interface InterviewSetup {
  jobDescription: string
  company?: string
  role?: string
  questionTypes: string[]
  questionCount: number
  feedbackTiming: 'each' | 'end'
}

export interface SessionInfo {
  sessionId: string
}
