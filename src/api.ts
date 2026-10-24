// The ONLY file that talks to the backend. Every function is mocked for now.
// Later, replace the mock bodies with fetch('/api/...') calls (relative URLs,
// proxied by Vite) and nothing else changes. Never hardcode localhost or ports.
import type {
  DebateSetup,
  InterviewSetup,
  LiveEvent,
  PublicSpeakingSetup,
  Results,
  SessionInfo,
} from './types'

const delay = <T>(value: T, ms = 600): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms))

export function startSession(
  _mode: 'publicSpeaking' | 'debate' | 'interview',
  _setup: PublicSpeakingSetup | DebateSetup | InterviewSetup,
): Promise<SessionInfo> {
  return delay({ sessionId: 'mock-session-1' })
}

export function getNextQuestion(_sessionId: string): Promise<string> {
  return delay('You mentioned your main point. Can you expand on that?')
}

export function submitAnswer(_sessionId: string, _audio?: Blob): Promise<void> {
  return delay(undefined)
}

export function getResults(_sessionId: string): Promise<Results> {
  return delay(mockResults, 900)
}

// Builds the WebSocket URL from window.location so it works through ngrok.
export function liveSocketUrl(sessionId: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${window.location.host}/ws/live/${sessionId}`
}

// Mock live feed: emits a few fake events on a timer. Returns an unsubscribe fn.
export function subscribeLive(
  _sessionId: string,
  onEvent: (event: LiveEvent) => void,
): () => void {
  const events: LiveEvent[] = [
    { type: 'mood', value: 'listening' },
    { type: 'indicator', id: 'filler_words', value: 1, status: 'ok' },
    { type: 'indicator', id: 'pace', value: 172, status: 'warn' },
    { type: 'indicator', id: 'volume', value: 0.6, status: 'ok' },
    { type: 'indicator', id: 'eye_contact', value: 0.8, status: 'ok' },
    { type: 'mood', value: 'happy' },
  ]
  const timers = events.map((e, i) => setTimeout(() => onEvent(e), 1500 * (i + 1)))
  return () => timers.forEach(clearTimeout)
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
