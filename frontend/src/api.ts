// The ONLY file that talks to the backend. Names match the backend exactly.
// features.useMocks false (the default): the real backend, reached through the Vite
// proxy with relative URLs (/api/..., /ws/...), never a hardcoded host or port.
// features.useMocks true: every function returns mock data. See API_CONTRACT.md.
import { features } from './features'
import { toWav } from './lib/audio'
import type {
  AnswerResult,
  AudienceQuestion,
  EventsMessage,
  Session,
  SessionCreate,
  SessionResults,
  SpeechResponse,
  VisionStats,
} from './types'

const delay = <T>(value: T, ms = 600): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms))

// A backend error. `message` is safe to show to the speaker; `detail` is the backend's own text.
export class ApiError extends Error {
  status: number
  detail: string
  constructor(message: string, status: number, detail: string) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

function friendlyMessage(status: number, detail: string): string {
  if (detail.includes('corrupt or unsupported data')) {
    return "I couldn't read that audio. Try recording again, or upload an mp3, m4a, wav, webm or mp4 file."
  }
  if (status === 502 && detail.includes('list index out of range')) {
    return "I couldn't find any speech in that recording. Check that it has sound and is long enough."
  }
  if (status === 500) return 'The server had a hiccup. Please try again.'
  if (detail.length > 200) return 'Speech analysis failed. Please try again.'
  return detail
}

const RETRY_STATUSES = [500, 502, 503, 504]
const RETRY_WAIT_MS = 500

// `retries` is for calls that are safe to repeat: after the database drops an idle
// connection the first request fails and the next one works.
async function http<T>(path: string, init?: RequestInit, retries = 0): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let response: Response
    try {
      response = await fetch(`/api${path}`, init)
    } catch {
      if (attempt < retries) {
        await delay(undefined, RETRY_WAIT_MS)
        continue
      }
      throw new ApiError("I couldn't reach the server. Check your connection and try again.", 0, '')
    }
    if (response.ok) return response.json() as Promise<T>
    let detail = response.statusText
    try {
      const body = await response.json()
      if (typeof body?.detail === 'string') detail = body.detail
    } catch {
      // keep the status text
    }
    if (attempt < retries && RETRY_STATUSES.includes(response.status)) {
      await delay(undefined, RETRY_WAIT_MS)
      continue
    }
    throw new ApiError(friendlyMessage(response.status, detail), response.status, detail)
  }
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
    }, 1)
  }
  const session: Session = { session_id: crypto.randomUUID(), ...data, results: null }
  mockSessions.push(session)
  return delay(session)
}

// GET /sessions/{session_id}
export function getSession(session_id: string): Promise<Session> {
  if (!features.useMocks) return http<Session>(`/sessions/${encodeURIComponent(session_id)}`, undefined, 1)
  const found = mockSessions.find((s) => s.session_id === session_id)
  return found ? delay(found) : Promise.reject(new Error('Session not found'))
}

// POST /sessions/{session_id}/question. Spends one web search, so call it only when
// the speaker calls on the mascot.
export function askQuestion(session_id: string): Promise<AudienceQuestion> {
  if (!features.useMocks) {
    return http<AudienceQuestion>(`/sessions/${encodeURIComponent(session_id)}/question`, { method: 'POST' })
  }
  return delay(
    {
      question: 'A survey I found ranks public speaking below several other fears. Where does your claim come from?',
      claim: 'Most people fear public speaking more than death',
      search_query: 'fear of public speaking vs death statistics',
      source: {
        title: 'Survey of American Fears',
        url: 'https://example.com/fear-survey',
        snippet: 'Public speaking ranked behind several other fears.',
      },
    },
    2000,
  )
}

// POST /sessions/{session_id}/answer. The question text is sent along because the
// backend does not store questions.
export function rateAnswer(session_id: string, audio: Blob, asked: AudienceQuestion): Promise<AnswerResult> {
  if (!features.useMocks) {
    const form = new FormData()
    form.append('audio', audio, `answer.${extensionFor(audio.type)}`)
    form.append('question', asked.question)
    form.append('claim', asked.claim)
    return http<AnswerResult>(`/sessions/${encodeURIComponent(session_id)}/answer`, { method: 'POST', body: form })
  }
  return delay(
    {
      transcript: 'I read it in a blog post, but you are right, I should check the original survey.',
      metrics: { wpm: 138, fillers: 1, filler_list: ['um'], speaking_time: 6.2 },
      rating: {
        score: 6,
        answered: true,
        did_well: 'You owned the gap honestly: "you are right, I should check the original survey."',
        improve: 'Name a concrete source or number next time instead of "a blog post".',
        robot_line: 'Honest answer! Bring a real source next time.',
      },
    },
    2500,
  )
}

// GET /history/{speaker}
export function getHistory(speaker: string): Promise<Session[]> {
  if (!features.useMocks) return http<Session[]>(`/history/${encodeURIComponent(speaker)}`, undefined, 1)
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
  if (type.includes('quicktime')) return 'mov'
  if (type.includes('m4a')) return 'm4a'
  if (type.includes('mp4')) return 'mp4'
  if (type.includes('ogg')) return 'ogg'
  if (type.includes('wav')) return 'wav'
  if (type.includes('flac')) return 'flac'
  if (type.includes('mpeg')) return 'mp3'
  return 'webm'
}

// POST /speech (multipart: file field "audio", optional form fields "session_id" and
// "vision" as a JSON string). The real backend also broadcasts state/metrics/feedback/lcd
// events while it works; the mock does the same.
export async function postSpeech(audio: Blob, options: PostSpeechOptions = {}): Promise<SpeechResponse> {
  if (features.useMocks) return mockSpeechRun(options)
  const send = (file: Blob, filename: string) => {
    const form = new FormData()
    form.append('audio', file, filename)
    if (options.session_id) form.append('session_id', options.session_id)
    if (options.vision) form.append('vision', JSON.stringify(options.vision))
    if (options.target_length_sec) form.append('target_length_sec', String(options.target_length_sec))
    return http<SpeechResponse>('/speech', { method: 'POST', body: form })
  }
  // An uploaded file keeps its own name; a recording gets one that matches its MIME type.
  const filename = audio instanceof File && audio.name ? audio.name : `speech.${extensionFor(audio.type)}`
  try {
    return await send(audio, filename)
  } catch (error) {
    // Some recordings and videos are in a container the speech-to-text service rejects.
    // Decode the sound here and send it again as plain WAV.
    if (!(error instanceof ApiError) || !error.detail.includes('corrupt or unsupported data')) throw error
    const wav = await toWav(audio)
    if (!wav) throw error
    return send(wav, `${filename.replace(/\.[^.]+$/, '')}.wav`)
  }
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
  mockBroadcast({ type: 'metrics', value: mockResultsFull.metrics })
  mockBroadcast({ type: 'feedback', value: mockResultsFull.feedback })
  mockBroadcast({ type: 'lcd', value: `Score: ${mockResultsFull.feedback.overall}/100` })
  mockBroadcast({ type: 'state', value: 'speaking' })
  setTimeout(() => mockBroadcast({ type: 'state', value: 'idle' }), 1500)
  const session = mockSessions.find((s) => s.session_id === options.session_id)
  if (options.session_id && !session) throw new Error('Session not found')
  if (session) session.results = mockResultsFull
  return { ...mockResultsFull, session_id: session?.session_id ?? null, saved: !!session }
}

// Mock data follows the real backend, plus the fields the backend does not return yet
// (body_language, criteria, extra metrics) so the whole Results screen can be previewed.
const mockResultsFull: SessionResults = {
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

// Second mock for the empty states: no camera (no eye_contact, posture, body_language) and
// no script (no script_coverage). Scores are recomputed from the criteria that remain.
const metricsNoCamera = { ...mockResultsFull.metrics }
delete metricsNoCamera.eye_contact_pct
delete metricsNoCamera.posture_alerts
const mockResultsNoCamera: SessionResults = {
  transcript: mockResultsFull.transcript,
  metrics: metricsNoCamera,
  feedback: {
    ...mockResultsFull.feedback,
    scores: { structure: 9, clarity: 6, delivery: 7, persuasion: 6, confidence: 6 },
    overall: 72,
    criteria: mockResultsFull.feedback.criteria?.filter(
      (c) => c.id !== 'eye_contact' && c.id !== 'posture' && c.id !== 'script_coverage',
    ),
  },
}

// Third dev-only variant: no criteria array at all, so only the category scores exist.
const mockResultsScoresOnly: SessionResults = {
  ...mockResultsFull,
  feedback: { ...mockResultsFull.feedback, criteria: undefined },
}

export type MockVariant = 'full' | 'no_camera' | 'scores_only'

export const mockResultsByVariant: Record<MockVariant, SessionResults> = {
  full: mockResultsFull,
  no_camera: mockResultsNoCamera,
  scores_only: mockResultsScoresOnly,
}
