// Keep in sync with API_CONTRACT.md. Types marked "backend" mirror what the Python
// server already returns; types marked "frontend" are view models the backend does
// not provide yet (see API_CONTRACT.md for which is which).

export const MOODS = [
  'idle',
  'listening',
  'confused',
  'bored',
  'handRaised',
  'speaking',
  'happy',
  'thinking',
] as const

export type Mood = (typeof MOODS)[number]

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

// frontend view model: the backend does not return this yet (API_CONTRACT.md, section 3.2)
export interface Results {
  overall: number
  categories: CategoryScore[]
  criteria: CriterionScore[]
  transcript: TranscriptWord[]
  questions: string[]
}

// ---- backend: POST /speech response (backend/pipeline.py run_session) ----

export interface SpeechMetrics {
  wpm: number
  fillers: number
  filler_list: string[]
  pauses: number // pauses over 2 s
  longest_pause: number // seconds
  speaking_time: number // seconds
  // Browser vision stats are merged in here by run_session, shape not settled yet.
  [vision: string]: unknown
}

export interface SpeechFeedback {
  scores: {
    structure: number
    clarity: number
    delivery: number
    persuasion: number
    confidence: number
  } // each 0-10
  overall: number // 0-100
  strengths: string[]
  fixes: string[]
  robot_line: string // short line the robot speaks at the end
}

export interface SpeechResponse {
  transcript: string
  metrics: SpeechMetrics
  feedback: SpeechFeedback
}

// ---- backend: WebSocket /events, every message is {type, value} ----

export type BackendState = 'idle' | 'listening' | 'thinking' | 'speaking'
export type AlertKind = 'posture' | 'hands' | 'eye_contact' | 'too_fast' | 'too_quiet' | 'filler'

export interface StateEvent { type: 'state'; value: BackendState }
export interface AlertEvent { type: 'alert'; value: AlertKind }
export interface LcdEvent { type: 'lcd'; value: string } // max 16 chars, robot only
export interface FeedbackEvent { type: 'feedback'; value: SpeechFeedback }
export interface MetricsEvent { type: 'metrics'; value: SpeechMetrics }
export interface HandEvent { type: 'hand'; value: 'raise' | 'lower' }
export interface UserPresentEvent { type: 'user_present'; value: null }

export type LiveEvent =
  | StateEvent
  | AlertEvent
  | LcdEvent
  | FeedbackEvent
  | MetricsEvent
  | HandEvent
  | UserPresentEvent

// Setup payloads (frontend forms; the backend only accepts `topic` so far, see API_CONTRACT.md)
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

// ---- backend: /sessions ----

export interface SessionCreate {
  speaker: string
  mode: string // free string on the backend; the frontend sends a ModeId
  topic: string
}

export interface Session extends SessionCreate {
  session_id: string // UUID4
}
