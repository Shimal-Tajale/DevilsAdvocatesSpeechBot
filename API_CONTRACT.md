# API contract: frontend <-> backend

What the frontend needs from the backend, based on `src/types.ts` and `src/api.ts`.
Where the backend already defines a shape (`backend/`, `docs/Deisgn_Doc.txt`), this file
uses the backend's shape. Everything else is a proposal for the backend team.

Status of every item:

- **[IN BACKEND]** exists today in `backend/`.
- **[IN BACKEND, STUBBED]** the route and shape exist, but the values are fake constants.
- **[BACKEND NEEDS TO BUILD]** nothing exists yet. The shape below is the frontend's proposal.

Source of truth in code: `src/types.ts` (types) and `src/api.ts` (the only file that talks to the backend).

## 0. Running it

- Start (from the repo root): `uvicorn backend.main:app --port 8000`. Port 8000 is implied (uvicorn default, and `bridge/bridge.py` connects to `ws://localhost:8000/events`). No file sets it, so teammates should confirm.
- Needs `.env` with `DEEPGRAM_API_KEY` (copy `.env.example`). Without it `POST /speech` returns a 500.
- CORS is open to all origins, but the browser never calls the backend directly. Only port 80 is exposed through ngrok, so the frontend calls relative URLs and the Vite dev proxy forwards them.
- **Backend routes have no prefix** (`/sessions`, `/speech`, `/events`). The frontend uses `/api/...` and `/ws/...`. The current proxy forwards the prefix unchanged, so it must be changed to strip it (`rewrite: p => p.replace(/^\/api/, '')`, same for `/ws`). **Frontend TODO, not done yet.**
  - `/api/sessions` -> `/sessions`
  - `/api/speech` -> `/speech`
  - `/ws/events` -> `/events`

## 1. HTTP endpoints

### 1.1 `POST /sessions` [IN BACKEND]

Create a session. `api.ts`: `startSession(data)`.

Request (JSON, all fields required, non-empty after trimming whitespace):

```ts
interface SessionCreate { speaker: string; mode: string; topic: string }
```

Response `201`:

```ts
interface Session extends SessionCreate { session_id: string } // UUID4
```

Errors: `422` for missing, empty, whitespace-only or non-string fields.

Notes:
- `mode` is a free string on the backend. The frontend sends its mode id: `publicSpeaking`, `debate` or `interview`. The design doc also lists `Drill`. Backend to confirm accepted values.
- The frontend has no speaker login. It will send a name from a field on the home or setup screen (or a default such as "Guest").
- Mode-specific setup does not fit in this request yet. See 1.7.

### 1.2 `GET /sessions/{session_id}` [IN BACKEND]

`api.ts`: `getSession(sessionId)`. Response: `Session` (same as above). `404 {"detail":"Session not found"}`, `422` if the id is not a UUID.

Returns only the setup. It does not return results (see 1.6).

### 1.3 `GET /history/{speaker}` [IN BACKEND]

`api.ts`: `getHistory(speaker)`. Response: `Session[]`, `[]` for an unknown speaker.

Setups only, no scores, so the History screen (behind the `history` flag) cannot chart progress yet. See 1.8.

### 1.4 `POST /speech` [IN BACKEND, STUBBED]

Upload a finished recording and run the full pipeline. `api.ts`: `analyzeSpeech(audio)`.

Request: `multipart/form-data` with one file field named `audio` (a `MediaRecorder` blob).

Response `200`:

```ts
interface SpeechResponse {
  transcript: string
  metrics: SpeechMetrics
  feedback: SpeechFeedback
}

interface SpeechMetrics {
  wpm: number
  fillers: number
  filler_list: string[]
  pauses: number          // pauses over 2 s
  longest_pause: number   // seconds
  speaking_time: number   // seconds
  // browser vision stats (posture alerts, eye-contact %, gesture level) are merged
  // in by run_session(audio, vision); their key names are not settled
}

interface SpeechFeedback {
  scores: { structure: number; clarity: number; delivery: number; persuasion: number; confidence: number } // each 0-10
  overall: number         // 0-100
  strengths: string[]
  fixes: string[]
  robot_line: string      // short line the robot speaks at the end
}
```

What is real today:
- `transcript`: real Deepgram text (nova-3, smart format, filler words on).
- `metrics`, `feedback`: **fake constants** (`wpm 142`, `fillers 2`, overall 68, and so on). Needs the real metrics code and the AI call (Gemini or Muse).

Gaps in this endpoint, all **[BACKEND NEEDS TO BUILD]**:
- Return word timestamps. The pipeline already computes `words: [{word, start, end}]` and `duration` but the response drops them. The frontend needs them for the highlighted transcript and the timeline.
- Accept a `session_id` (form field) so results can be tied to a session and saved.
- Accept the browser's vision stats (`run_session` already takes a `vision` dict, but the route never passes one).
- The route has no field for which question is being answered (see 1.5).

### 1.5 Hand-raise question and answer [BACKEND NEEDS TO BUILD]

The mascot raises its hand after the speech, the user "calls on" it, and it asks a question (CLAUDE.md "Mascot behavior"). The design doc plans this as the `hand` event plus an AI-written question and TTS, but nothing is implemented. `api.ts`: `getNextQuestion(sessionId)`.

Proposed:

```
GET /sessions/{session_id}/question
-> 200 { question: string, index: number, total: number } | 204 when there are no more
```

The answer is audio and should reuse `POST /speech` with `session_id` and `question_index` form fields, returning a `SpeechResponse` scored as a mini-session (design doc: "the speaker's answer is recorded and scored as a mini-session").

Interview mode reuses this same flow, with the question coming first. Debate mode needs rebuttal text from the opponent, which would use the same shape.

### 1.6 Rich results [BACKEND NEEDS TO BUILD]

`api.ts`: `getResults(sessionId)` returns this frontend view model (`Results` in `types.ts`):

```ts
interface Results {
  overall: number                // 0-100
  categories: { id: 'voice' | 'body' | 'content'; score: number }[]
  criteria: {
    id: 'filler_words' | 'pace' | 'volume' | 'vocal_variety' | 'pauses' | 'eye_contact' |
        'posture' | 'relevance' | 'structure' | 'script_coverage' | 'confident_language' | 'timing'
    category: 'voice' | 'body' | 'content'
    score: number                // 0-100
    detail: string               // one line, e.g. "14 fillers (5.2/min)"
    tip: string
  }[]
  transcript: { start: number; text: string; flag?: 'filler' | 'hedge' }[]  // seconds
  questions: string[]
}
```

```
GET /sessions/{session_id}/results -> 200 Results | 404
```

This does not exist and conflicts with what the backend settled on: the backend has 5 scores on a 0-10 scale (`structure`, `clarity`, `delivery`, `persuasion`, `confidence`), flat `strengths`/`fixes` lists, and a plain-string transcript. Decision needed from the team:

- Option A (frontend adapts): the frontend builds its Results screen from `SpeechResponse` (5 scores, strengths first, fixes, transcript with filler words highlighted using `words` and `metrics.filler_list`). The 12-criterion scoring is cut.
- Option B (backend extends): the backend returns the `Results` shape above, either as an extra block on the speech response or from this endpoint.

Until then the frontend keeps `Results` and its mock so the Results screen can be built either way.

### 1.7 Per-mode setup fields [BACKEND NEEDS TO BUILD]

`SessionCreate` has only `speaker`, `mode` and `topic`. The setup screens collect more, and the backend would need to accept and store them (for prompts and scoring). Proposed optional fields on `POST /sessions`:

```ts
interface PublicSpeakingSetup { topic: string; targetMinutes: number; script?: string }
interface DebateSetup { motion: string; side: 'for' | 'against'; difficulty: 'easy' | 'medium' | 'hard' }
interface InterviewSetup {
  jobDescription: string; company?: string; role?: string
  questionTypes: string[]; questionCount: number; feedbackTiming: 'each' | 'end'
}
```

Suggested: send these as a `setup` object next to `speaker`, `mode`, `topic`, and return it unchanged on `GET /sessions/{id}`. Until then the frontend sends only the three required fields and uses `topic` for the main subject (public speaking topic, debate motion, interview role or job).

### 1.8 History with scores [BACKEND NEEDS TO BUILD]

`GET /history/{speaker}` should include each session's overall score and date so the progress chart (stretch goal, `history` flag is off) has data. The design doc plans `sessions(id, speaker, mode, topic, started_at, overall_score)` in Postgres. Sessions are in-memory today and are lost on restart.

## 2. WebSocket `/events` [IN BACKEND]

One shared two-way event bus. Any JSON message a client sends is rebroadcast to every connected client, including the sender. Frontend URL: `/ws/events` (built from `window.location` in `api.ts`: `eventsSocketUrl()`). There is no session id and no per-session routing, so every client sees every event.

Every message is `{ "type": string, "value": ... }`:

```ts
type LiveEvent =
  | { type: 'state'; value: 'idle' | 'listening' | 'thinking' | 'speaking' }
  | { type: 'alert'; value: 'posture' | 'hands' | 'eye_contact' | 'too_fast' | 'too_quiet' | 'filler' }
  | { type: 'lcd'; value: string }                          // max 16 chars, robot only
  | { type: 'feedback'; value: SpeechFeedback }
  | { type: 'metrics'; value: SpeechMetrics }
  | { type: 'hand'; value: 'raise' | 'lower' }
  | { type: 'user_present'; value: null }
```

| Event | Direction | Status | Frontend does |
|---|---|---|---|
| `state` | server -> client | [IN BACKEND, PARTIAL] `/speech` sends `thinking`, `speaking`, `idle`. `listening` is in the contract but nothing sends it. | Drives mascot mood (see 3.1). |
| `alert` | browser -> server -> all | [IN BACKEND] relay only. The server never creates alerts. | The browser **sends** `posture`, `hands`, `eye_contact` from the vision module (`frontend/src/vision`) and `too_fast`, `too_quiet`, `filler` from audio checks. It **receives** alerts to pulse the indicator rail and move the mascot. |
| `metrics` | server -> client | [IN BACKEND, STUBBED] sent by `/speech`. | Optional: charts. The HTTP response carries the same data. |
| `feedback` | server -> client | [IN BACKEND, STUBBED] sent by `/speech`. | Optional: same data as the HTTP response. |
| `lcd` | server -> client | [IN BACKEND] | Ignored (robot only). |
| `hand` | server -> client | [BACKEND NEEDS TO BUILD] the bridge handles it, but nothing sends it. | `raise` puts the mascot in `handRaised` and shows the "Call on mascot" button. `lower` ends it. |
| `user_present` | bridge -> server -> all | [IN BACKEND] relay only, sent by the bridge from the sensor. | Optional: opens the session screen. |

Rules from the design doc, to keep in mind in the browser: an alert needs about 2 s of sustained behavior, and at most one alert of each kind every 12 s. The vision module already follows both.

### 2.1 Live indicators [BACKEND NEEDS TO BUILD]

The live rail wants four indicators (filler words, pace, volume, eye contact). The backend only relays threshold alerts (`filler`, `too_fast`, `too_quiet`, `eye_contact`), with no numbers. The frontend plan:

- Filler counter: increment on each `filler` alert.
- Pace / volume: show warn state on `too_fast` / `too_quiet`. A real speedometer or volume level needs live numbers. Volume can come from the Web Audio API in the browser. Live pace needs the stretch `WS /stream` (live audio to Deepgram), which does not exist.
- Eye contact: from the vision module, in the browser.

No new backend work is needed for the alert-only version.

## 3. Frontend-only (no backend work)

### 3.1 Mascot mood

The mascot mood is a frontend concept. The backend has no mood event, and the earlier proposal for `{type:'mood'}` was dropped. The frontend derives the mood:

| Source | Mood |
|---|---|
| `state: idle` | `idle` |
| `state: listening` or recording | `listening` |
| `state: thinking` | `thinking` |
| `state: speaking` | `speaking` |
| `hand: raise` | `handRaised` |
| `alert: filler` | brief head tilt while `listening` |
| `alert: eye_contact` | `confused` or `bored` |
| feedback with a high score | `happy` |

### 3.2 Not in the contract

Not-real endpoints from older drafts have been removed: `submitAnswer`, `GET /sessions/{id}` returning results, and a per-session socket `/ws/live/{id}`.

## 4. Summary

| Item | Status |
|---|---|
| `POST /sessions` | IN BACKEND |
| `GET /sessions/{id}` | IN BACKEND (setup only) |
| `GET /history/{speaker}` | IN BACKEND (setups only) |
| `POST /speech` | IN BACKEND, STUBBED (real transcript, fake metrics and feedback) |
| `WS /events` relay | IN BACKEND |
| Events `state`, `alert`, `lcd`, `feedback`, `metrics`, `user_present` | IN BACKEND |
| Word timestamps in the `/speech` response | BACKEND NEEDS TO BUILD |
| `session_id` and vision stats on `/speech` | BACKEND NEEDS TO BUILD |
| Real metrics and AI feedback | BACKEND NEEDS TO BUILD |
| `hand` event, mascot question endpoint, answer scoring | BACKEND NEEDS TO BUILD |
| Rich results (12 criteria, categories, flagged transcript) | BACKEND NEEDS TO BUILD (or frontend adapts, see 1.6) |
| Per-mode setup fields | BACKEND NEEDS TO BUILD |
| History with scores, persistence | BACKEND NEEDS TO BUILD |
| `listening` state sent by the server | BACKEND NEEDS TO BUILD |
| Live pace and volume numbers (`WS /stream`) | BACKEND NEEDS TO BUILD (stretch) |
| Proxy prefix stripping (`/api`, `/ws`) | FRONTEND TODO |
