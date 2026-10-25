// Everything that crosses the wire uses the backend's names exactly (snake_case for
// fields, events and string values). camelCase is only for local React names.
// Keep in sync with API_CONTRACT.md and RUBRIC.md.

// ---- frontend-only: mascot mood prop ----

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

// ---- modes ----

export type ModeId = 'presentation' | 'debate' | 'interview'

// ---- sessions: POST /sessions, GET /sessions/{id}, GET /history/{speaker} ----
// The backend only accepts these three fields today. target_length_sec and script
// are not accepted yet (extra fields are silently dropped), so they are not sent.

export interface SessionCreate {
  speaker: string
  mode: ModeId
  topic: string
}

export interface Session extends SessionCreate {
  session_id: string // UUID4
  // Set by POST /speech when it is sent with this session_id; null until then.
  results: SessionResults | null
}

// ---- scoring (RUBRIC.md) ----

export type CategoryId = 'structure' | 'clarity' | 'delivery' | 'body_language' | 'persuasion'

export type CriterionId =
  | 'filler_words'
  | 'confident_language'
  | 'relevance'
  | 'pace'
  | 'pauses'
  | 'volume'
  | 'vocal_variety'
  | 'structure'
  | 'timing'
  | 'script_coverage'
  | 'eye_contact'
  | 'posture'
  | 'evidence'

export interface CriterionScore {
  id: CriterionId
  category: CategoryId
  score: number // whole number 0-10
  detail: string // states the measured number
  tip: string // one concrete action
}

// ---- POST /speech response ----

// What the browser tallies from the vision module's alerts during a speech. Sent with
// POST /speech as the JSON form field `vision`. The backend rejects unknown keys.
export interface VisionStats {
  posture_alerts?: number
  hands_alerts?: number
  eye_contact_alerts?: number
  eye_contact_pct?: number | null // null = not measured
  // which behaviour each posture/hands alert was
  slouch_alerts?: number
  sway_alerts?: number
  pocket_alerts?: number
  fidget_alerts?: number
}

export interface Metrics {
  // always returned by the backend
  wpm: number
  fillers: number
  filler_list: string[]
  pauses: number // pauses over 2 s
  longest_pause: number // seconds
  speaking_time: number // seconds, first word to last word
  // merged in from the vision stats, present only when the browser sent them
  posture_alerts?: number
  hands_alerts?: number
  eye_contact_alerts?: number
  eye_contact_pct?: number | null
  slouch_alerts?: number // these four only from sessions recorded after they were added
  sway_alerts?: number
  pocket_alerts?: number
  fidget_alerts?: number
  // RUBRIC.md fields the backend does not return yet
  hedge_count?: number
  audible_pct?: number
  duration_sec?: number
  target_length_sec?: number
}

export interface Scores {
  structure: number
  clarity: number
  delivery: number
  body_language?: number // not returned by the backend yet
  persuasion: number
  confidence: number
} // whole numbers 0-10

export interface Feedback {
  scores: Scores
  overall: number // 0-100
  strengths: string[]
  fixes: string[]
  robot_line: string
  criteria?: CriterionScore[] // not returned by the backend yet; the detailed section renders only when present
}

// What a session stores and GET /sessions/{id} returns under `results`.
export interface SessionResults {
  transcript: string
  metrics: Metrics
  feedback: Feedback
}

// POST /sessions/{session_id}/question: the mascot's audience question after a speech,
// from one web search. source is null when nothing useful was found (or no search key).
export interface AudienceQuestion {
  question: string // a counter-argument in debate mode
  claim: string // presentation: the claim asked about; debate: the speaker's position; interview: what it probes
  search_query: string // debate joins its two queries with " | "; interview searches nothing
  source: { title: string; url: string; snippet: string } | null
  kind?: 'question' | 'counter' | 'interview'
}

// POST /sessions/{session_id}/answer: the speaker's recorded answer to that question,
// rated once. score is 0-10; answered is false when the answer dodged the question.
export interface AnswerResult {
  transcript: string
  metrics: { wpm: number; fillers: number; filler_list: string[]; speaking_time: number }
  rating: { score: number; answered: boolean; did_well: string; improve: string; robot_line: string }
}

// POST /speech response.
export interface SpeechResponse extends SessionResults {
  session_id: string | null // null when the request had no session_id
  saved: boolean // false: no session_id, or saving failed (the feedback is still returned)
}

// ---- WebSocket /events: every message is {type, value} ----

export type StateValue = 'idle' | 'listening' | 'thinking' | 'speaking'
export type AlertValue = 'posture' | 'hands' | 'eye_contact' | 'too_fast' | 'too_quiet' | 'filler'
export type HandValue = 'raise' | 'lower'

export interface StateEvent { type: 'state'; value: StateValue }
// Which behaviour a posture/hands alert was. Optional; the robot ignores it.
export type AlertDetail = 'slouch' | 'sway' | 'pockets' | 'fidget'
export interface AlertEvent { type: 'alert'; value: AlertValue; detail?: AlertDetail }
export interface LcdEvent { type: 'lcd'; value: string } // max 16 chars, robot only
export interface FeedbackEvent { type: 'feedback'; value: Feedback }
export interface MetricsEvent { type: 'metrics'; value: Metrics }
export interface HandEvent { type: 'hand'; value: HandValue }
export interface UserPresentEvent { type: 'user_present'; value: null }

export type EventsMessage =
  | StateEvent
  | AlertEvent
  | LcdEvent
  | FeedbackEvent
  | MetricsEvent
  | HandEvent
  | UserPresentEvent
