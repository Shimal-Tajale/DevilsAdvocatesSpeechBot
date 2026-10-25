// The ONLY file that talks to the backend. Names match the backend exactly.
// features.useMocks false (the default): the real backend, reached through the Vite
// proxy with relative URLs (/api/..., /ws/...), never a hardcoded host or port.
// features.useMocks true: every function returns mock data. See API_CONTRACT.md.
import { features } from './features'
import type {
  EventsMessage,
  Session,
  SessionCreate,
  SessionResults,
  SpeechResponse,
  VisionStats,
} from './types'

const delay = <T>(value: T, ms = 600): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms))

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init)
  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = await response.json()
      if (typeof body?.detail === 'string') detail = body.detail
    } catch {
      // keep the status text
    }
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

// ---- sessions ----

const mockSessions: Session[] = []

// POST /sessions
export function createSession(data: SessionCreate): Promise<Session> {
  if (!features.useMocks) {
    return http<Session>('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }
  const session: Session = { session_id: crypto.randomUUID(), ...data, results: null }
  mockSessions.push(session)
  return delay(session)
}

// GET /sessions/{session_id}
export function getSession(session_id: string): Promise<Session> {
  if (!features.useMocks) return http<Session>(`/sessions/${encodeURIComponent(session_id)}`)
  const found = mockSessions.find((s) => s.session_id === session_id)
  return found ? delay(found) : Promise.reject(new Error('Session not found'))
}

// GET /history/{speaker}
export function getHistory(speaker: string): Promise<Session[]> {
  if (!features.useMocks) return http<Session[]>(`/history/${encodeURIComponent(speaker)}`)
  return delay(mockSessions.filter((s) => s.speaker === speaker))
}

// ---- speech ----

export interface PostSpeechOptions {
  session_id?: string // saves the results on that session (404 if it does not exist)
  vision?: VisionStats // the browser's tally of vision alerts, merged into the metrics
  target_length_sec?: number // sent along, but the backend does not read it yet
}

// File extension that matches a recording's real MIME type (Safari records mp4, others webm or ogg).
function extensionFor(mime: string): string {
  const type = mime.split(';')[0].trim().toLowerCase()
  if (type.includes('mp4')) return 'mp4'
  if (type.includes('ogg')) return 'ogg'
  if (type.includes('wav')) return 'wav'
  if (type.includes('mpeg')) return 'mp3'
  return 'webm'
}

// POST /speech (multipart: file field "audio", optional form fields "session_id" and
// "vision" as a JSON string). The real backend also broadcasts state/metrics/feedback/lcd
// events while it works; the mock does the same.
export function postSpeech(audio: Blob, options: PostSpeechOptions = {}): Promise<SpeechResponse> {
  if (!features.useMocks) {
    const form = new FormData()
    form.append('audio', audio, `speech.${extensionFor(audio.type)}`)
    if (options.session_id) form.append('session_id', options.session_id)
    if (options.vision) form.append('vision', JSON.stringify(options.vision))
    if (options.target_length_sec) form.append('target_length_sec', String(options.target_length_sec))
    return http<SpeechResponse>('/speech', { method: 'POST', body: form })
  }
  return mockSpeechRun(options)
}

// ---- WS /events ----

export interface EventsConnection {
  send: (message: EventsMessage) => void
  close: () => void
}

// Built from window.location so it works through ngrok (wss when the page is https).
function eventsSocketUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${window.location.host}/ws/events`
}

// Connects to the shared event bus. Like the backend, every sent message is delivered
// to every connection, including the sender's.
export function connectEvents(onMessage: (message: EventsMessage) => void): EventsConnection {
  if (features.useMocks) {
    mockListeners.add(onMessage)
    return {
      send: (message) => mockBroadcast(message),
      close: () => void mockListeners.delete(onMessage),
    }
  }

  let socket: WebSocket | null = null
  let closed = false
  let retry: ReturnType<typeof setTimeout> | undefined
  const open = () => {
    socket = new WebSocket(eventsSocketUrl())
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        if (typeof message?.type === 'string') onMessage(message as EventsMessage)
      } catch {
        // ignore messages that are not JSON
      }
    }
    socket.onclose = () => {
      if (!closed) retry = setTimeout(open, 2000)
    }
  }
  open()
  return {
    send: (message) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    },
    close: () => {
      closed = true
      clearTimeout(retry)
      socket?.close()
    },
  }
}

// ---- mocks ----

const mockListeners = new Set<(message: EventsMessage) => void>()

function mockBroadcast(message: EventsMessage) {
  queueMicrotask(() => mockListeners.forEach((listener) => listener(message)))
}

async function mockSpeechRun(options: PostSpeechOptions): Promise<SpeechResponse> {
  mockBroadcast({ type: 'state', value: 'thinking' })
  await delay(null, 1200)
  mockBroadcast({ type: 'metrics', value: mockResults.metrics })
  mockBroadcast({ type: 'feedback', value: mockResults.feedback })
  mockBroadcast({ type: 'lcd', value: `Score: ${mockResults.feedback.overall}/100` })
  mockBroadcast({ type: 'state', value: 'speaking' })
  setTimeout(() => mockBroadcast({ type: 'state', value: 'idle' }), 1500)
  const session = mockSessions.find((s) => s.session_id === options.session_id)
  if (options.session_id && !session) throw new Error('Session not found')
  if (session) session.results = mockResults
  return { ...mockResults, session_id: session?.session_id ?? null, saved: !!session }
}

// Mock data follows the real backend, plus the fields the backend does not return yet
// (body_language, criteria, extra metrics) so the whole Results screen can be previewed.
const mockResults: SessionResults = {
  transcript:
    "Um, so today I want to talk about, uh, why sleep matters. I think maybe the biggest reason is memory. Like, when you sleep, your brain replays the day. Um, students who sleep eight hours remember about forty percent more, uh, than students who don't. So tonight, try going to bed thirty minutes earlier.",
  metrics: {
    wpm: 168,
    fillers: 14,
    filler_list: ['um', 'uh', 'um', 'like', 'um', 'uh', 'you know', 'um', 'uh', 'like', 'um', 'um', 'uh', 'um'],
    pauses: 2,
    longest_pause: 3.1,
    speaking_time: 160,
    hedge_count: 6,
    audible_pct: 86,
    eye_contact_pct: 63,
    posture_alerts: 1,
    duration_sec: 170,
    target_length_sec: 180,
  },
  feedback: {
    scores: { structure: 8, clarity: 6, delivery: 7, body_language: 8, persuasion: 6, confidence: 7 },
    overall: 71,
    strengths: ['Strong opening hook that tells us why sleep matters', 'You finished right on time'],
    fixes: [
      "Cut the 'um' before 'the biggest reason is memory'",
      "Back up 'forty percent more' with a source or example",
      "Pause after 'try going to bed thirty minutes earlier' so it lands",
    ],
    robot_line: 'Great hook! Next time, pause instead of saying um.',
    criteria: [
      { id: 'filler_words', category: 'clarity', score: 4, detail: '14 fillers (5.3 per minute)', tip: "Pause instead of saying 'um' before a key point." },
      { id: 'confident_language', category: 'clarity', score: 6, detail: '6 hedges (2.2 per minute)', tip: "Swap 'I think maybe' for a direct statement." },
      { id: 'relevance', category: 'clarity', score: 8, detail: 'Every section served the topic', tip: 'Keep tying each point back to sleep and memory.' },
      { id: 'pace', category: 'delivery', score: 8, detail: '168 words per minute', tip: 'Slow down slightly on your main claim.' },
      { id: 'pauses', category: 'delivery', score: 6, detail: '2 pauses over 2 s, longest 3.1 s', tip: 'Keep pauses short unless they follow a big point.' },
      { id: 'volume', category: 'delivery', score: 8, detail: '86% of speaking time at an audible level', tip: 'Keep your volume steady at the ends of sentences.' },
      { id: 'vocal_variety', category: 'delivery', score: 5, detail: 'Some variation with flat stretches', tip: 'Stress the number when you say forty percent.' },
      { id: 'structure', category: 'structure', score: 8, detail: 'Hook, points and a closing ask are all present', tip: 'Make the closing line a little stronger.' },
      { id: 'timing', category: 'structure', score: 10, detail: '170 s of a 180 s target', tip: 'Nicely on time.' },
      { id: 'script_coverage', category: 'structure', score: 6, detail: 'Most script points covered, one rushed', tip: 'Spend a full sentence on the second point.' },
      { id: 'eye_contact', category: 'body_language', score: 8, detail: '63% of the time facing the camera', tip: 'Look at the camera when you state your main claim.' },
      { id: 'posture', category: 'body_language', score: 8, detail: '1 sustained posture alert', tip: 'Plant your feet to stay steady.' },
      { id: 'evidence', category: 'persuasion', score: 6, detail: 'One claim only asserted', tip: 'Name where the forty percent comes from.' },
    ],
  },
}
