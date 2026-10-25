// The ONLY file that talks to the backend. Every function is mocked for now.
// Later, replace the mock bodies with fetch('/api/...') calls (relative URLs,
// proxied by Vite) and nothing else changes. Never hardcode localhost or ports.
import type {
  LiveEvent,
  Results,
  Session,
  SessionCreate,
  SpeechResponse,
} from './types'

// Real routes (see API_CONTRACT.md). The dev proxy maps /api/* and /ws/* to the
// backend root, so POST /api/sessions reaches the backend's POST /sessions.

const delay = <T>(value: T, ms = 600): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms))

// POST /sessions -- already in the backend
export function startSession(data: SessionCreate): Promise<Session> {
  return delay({ session_id: 'mock-session-1', ...data })
}

// GET /sessions/{session_id} -- already in the backend (returns the setup only)
export function getSession(sessionId: string): Promise<Session> {
  return delay({ session_id: sessionId, speaker: 'Guest', mode: 'publicSpeaking', topic: 'Mock topic' })
}

// GET /history/{speaker} -- already in the backend (setups only, no scores)
export function getHistory(_speaker: string): Promise<Session[]> {
  return delay([])
}

// POST /speech (multipart field "audio") -- already in the backend, but metrics
// and feedback are still fake there
export function analyzeSpeech(_audio?: Blob): Promise<SpeechResponse> {
  return delay(mockSpeech, 1200)
}

// NOT in the backend yet: rich results (12 criteria, categories, flagged transcript)
export function getResults(_sessionId: string): Promise<Results> {
  return delay(mockResults, 900)
}

// NOT in the backend yet: mascot follow-up question (hand-raise Q&A)
export function getNextQuestion(_sessionId: string): Promise<string> {
  return delay('You mentioned your main point. Can you expand on that?')
}

// Builds the WebSocket URL from window.location so it works through ngrok.
// Backend path is /events; the /ws prefix is stripped by the dev proxy.
export function eventsSocketUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${window.location.host}/ws/events`
}

// WS /events, receiving. Mock: emits a few backend-shaped events on a timer.
// Returns an unsubscribe function.
export function subscribeLive(onEvent: (event: LiveEvent) => void): () => void {
  const events: LiveEvent[] = [
    { type: 'state', value: 'listening' },
    { type: 'alert', value: 'filler' },
    { type: 'alert', value: 'too_fast' },
    { type: 'alert', value: 'eye_contact' },
    { type: 'state', value: 'thinking' },
    { type: 'state', value: 'speaking' },
    { type: 'state', value: 'idle' },
  ]
  const timers = events.map((e, i) => setTimeout(() => onEvent(e), 1500 * (i + 1)))
  return () => timers.forEach(clearTimeout)
}

// WS /events, sending. The browser sends alerts (vision, volume) and the backend
// rebroadcasts them to everyone. Mock: no-op.
export function sendEvent(_event: LiveEvent): void {}

const mockSpeech: SpeechResponse = {
  transcript: 'Um, so today I want to talk about, uh, why sleep matters.',
  metrics: { wpm: 142, fillers: 2, filler_list: ['um', 'uh'], pauses: 1, longest_pause: 2.4, speaking_time: 45.0 },
  feedback: {
    scores: { structure: 7, clarity: 8, delivery: 6, persuasion: 7, confidence: 6 },
    overall: 68,
    strengths: ['Strong opening hook'],
    fixes: ["Cut 'um' before key points", 'Pause after your main claim'],
    robot_line: 'Great hook! Next time, slow down in the middle.',
  },
}

const mockResults: Results = {
  overall: 78,
  categories: [
    { id: 'voice', score: 71 },
    { id: 'body', score: 84 },
    { id: 'content', score: 80 },
  ],
  criteria: [
    { id: 'filler_words', category: 'voice', score: 64, detail: '14 fillers (5.2/min)', tip: "Try pausing instead of saying 'um'." },
    { id: 'pace', category: 'voice', score: 72, detail: '168 words per minute', tip: 'Slow down a little on key points.' },
    { id: 'volume', category: 'voice', score: 85, detail: 'Clear and steady', tip: 'Keep it up.' },
    { id: 'vocal_variety', category: 'voice', score: 66, detail: 'Some monotone stretches', tip: 'Vary your pitch on important words.' },
    { id: 'pauses', category: 'voice', score: 68, detail: '3 long pauses', tip: 'Use short pauses to let ideas land.' },
    { id: 'eye_contact', category: 'body', score: 88, detail: 'Looked at the camera 88% of the time', tip: 'Great, keep it natural.' },
    { id: 'posture', category: 'body', score: 80, detail: 'Upright with slight swaying', tip: 'Plant your feet to stay steady.' },
    { id: 'relevance', category: 'content', score: 86, detail: 'Stayed on topic', tip: 'Tie each story back to your main point.' },
    { id: 'structure', category: 'content', score: 78, detail: 'Clear intro and body, short conclusion', tip: 'End with one memorable takeaway.' },
    { id: 'script_coverage', category: 'content', score: 74, detail: '5 of 7 key points covered', tip: 'Cover the two missed points earlier.' },
    { id: 'confident_language', category: 'content', score: 76, detail: '6 hedges', tip: "Swap 'I think maybe' for a direct statement." },
    { id: 'timing', category: 'content', score: 86, detail: '4:40 of a 5:00 target', tip: 'Nicely on time.' },
  ],
  transcript: [
    { start: 0.4, text: 'Hello' },
    { start: 0.9, text: 'everyone' },
    { start: 3.2, text: 'um', flag: 'filler' },
    { start: 4.1, text: 'I' },
    { start: 4.3, text: 'think', flag: 'hedge' },
    { start: 4.6, text: 'maybe', flag: 'hedge' },
  ],
  questions: ['You mentioned X. Can you expand on that?'],
}
