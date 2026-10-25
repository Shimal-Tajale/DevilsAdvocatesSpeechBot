# API contract: frontend <-> backend

What the frontend sends and receives. Names are the backend's, exactly: snake_case for every
field, event and string value, with no aliases. Where the backend code, `docs/Deisgn_Doc.txt` and
`RUBRIC.md` disagree, the backend code wins and the difference is listed in section 6.

Status of each item:

- **[IN BACKEND]** exists in `backend/` today.
- **[IN BACKEND, PARTIAL]** exists, but some fields or values are missing.
- **[BACKEND NEEDS TO BUILD]** nothing exists yet. The shape is what the frontend expects (mostly from `RUBRIC.md`).

Types: `frontend/src/types.ts`. The only code that talks to the backend: `frontend/src/api.ts`
(`features.useMocks` false, the default = the real backend; true = mocks).

## 0. Running it

- Backend, from the repo root: `uvicorn backend.main:app --port 8000`. No code sets the port; 8000 is uvicorn's default and what `bridge/bridge.py` connects to.
- Needs `.env` with `DEEPGRAM_API_KEY` and `GEMINI_API_KEY` (see `.env.example`).
- Backend routes have no prefix. The browser calls `/api/...` and `/ws/...`, and the Vite proxy in `frontend/vite.config.ts` strips the prefix: `/api/speech` -> `/speech`, `/ws/events` -> `/events`.

## 1. HTTP

| `api.ts` function | Route | Status |
|---|---|---|
| `createSession` | `POST /sessions` | [IN BACKEND] |
| `getSession` | `GET /sessions/{session_id}` | [IN BACKEND] (includes `results`) |
| `getHistory` | `GET /history/{speaker}` | [IN BACKEND] (includes `results`) |
| `postSpeech` | `POST /speech` | [IN BACKEND, PARTIAL] |

### `POST /sessions`

Request (JSON, all required, whitespace trimmed, non-empty):
`{ speaker: string, mode: 'presentation' | 'debate' | 'interview', topic: string }`.
Response `201`: the same fields plus `session_id` (UUID4) and `results: null`. `422` on bad input.

`mode` is a free string on the backend. The frontend sends exactly `presentation`, `debate` or `interview`.

**Not accepted yet [BACKEND NEEDS TO BUILD]:** `target_length_sec` and `script`. The backend model has only `speaker`, `mode` and `topic`, and silently drops extra fields, so the frontend does not send them. `RUBRIC.md` needs both (`timing` and `script_coverage`).

### `GET /sessions/{session_id}`

`Session` with `results` (null until a recording was posted with this `session_id`), `404 {"detail":"Session not found"}`, `422` for a malformed UUID.

### `GET /history/{speaker}`

`Session[]` (each with `results`, oldest first with Postgres), `[]` for an unknown speaker. The speaker name comes from the name field on the Home screen.

### `POST /speech`

Request: `multipart/form-data` with file field `audio`, optional form field `session_id` (UUID; `404` if unknown; the results are saved on that session, and sending it again replaces them), and optional form field `vision`, a JSON string of `{ posture_alerts, hands_alerts, eye_contact_alerts, eye_contact_pct }` (non-negative integers, `eye_contact_pct` 0-100 or null; any other key returns `422`).

Response `200`: `{ session_id, saved, transcript, metrics, feedback }`. `session_id` is null without one. `saved` is false when there was no `session_id` or saving failed (for example the database is down); the feedback is returned either way.

```ts
metrics: {
  wpm: number; fillers: number; filler_list: string[]
  pauses: number            // pauses over 2 s
  longest_pause: number     // seconds
  speaking_time: number     // seconds, first word to last word
  // merged in from `vision` when the browser sent it [IN BACKEND]
  posture_alerts?: number; hands_alerts?: number; eye_contact_alerts?: number
  eye_contact_pct?: number | null
  // [BACKEND NEEDS TO BUILD] from RUBRIC.md
  hedge_count?: number; audible_pct?: number; duration_sec?: number; target_length_sec?: number
}
feedback: {
  scores: { structure; clarity; delivery; persuasion; confidence: number   // whole numbers 0-10
            body_language?: number }                                        // [BACKEND NEEDS TO BUILD]
  overall: number           // 0-100
  strengths: string[]
  fixes: string[]
  robot_line: string
  criteria?: { id; category; score; detail; tip }[]                         // [BACKEND NEEDS TO BUILD]
}
```

Criterion ids (13, from `RUBRIC.md`): `filler_words`, `confident_language`, `relevance`, `pace`, `pauses`, `volume`, `vocal_variety`, `structure`, `timing`, `script_coverage`, `eye_contact`, `posture`, `evidence`. Categories: `structure`, `clarity`, `delivery`, `body_language`, `persuasion` (plus the `confidence` composite, which appears in `scores` only).

The frontend renders the category bars from whichever `scores` are present, and the detailed criteria section only when `criteria` is present.

Errors: `400` empty file, `422` no speech detected, `502` the pipeline failed. All carry `{"detail": string}`, which `api.ts` throws as `Error(detail)`.

Still true today: word timestamps are computed but not returned. The frontend does not send `vision` yet, because the vision module (`frontend/src/vision`) is not wired into a recording screen.

Storage: Postgres when `DATABASE_URL` is set, otherwise an in-memory store that is lost on restart. Results rebuilt from Postgres contain `transcript`, `metrics` and `feedback` without `criteria`, and `overall` comes from the stored score.

## 2. WebSocket `/events` [IN BACKEND]

One shared two-way bus. Any JSON message a client sends is rebroadcast to every client, including the sender. `connectEvents(onMessage)` returns `{ send, close }`. No session id, no per-session routing.

Every message is `{ "type", "value" }`:

| type | value | sent by | status |
|---|---|---|---|
| `state` | `idle` / `listening` / `thinking` / `speaking` | server | [IN BACKEND, PARTIAL] `/speech` sends `thinking`, `speaking`, `idle`; nothing sends `listening` |
| `alert` | `posture` / `hands` / `eye_contact` / `too_fast` / `too_quiet` / `filler` | browser (vision, audio) | [IN BACKEND] relay only; the server never creates alerts |
| `lcd` | string, max 16 chars | server | [IN BACKEND] robot only, the frontend ignores it |
| `feedback` | the feedback object | server | [IN BACKEND] sent by `/speech` |
| `metrics` | the metrics object | server | [IN BACKEND] sent by `/speech` |
| `hand` | `raise` / `lower` | server | [BACKEND NEEDS TO BUILD] the bridge handles it, nothing sends it; the frontend sends `lower` when the user clicks Take question |
| `user_present` | `null` | bridge | [IN BACKEND] relay only |

Frontend behavior:

- `state` values map straight onto the mascot `mood` prop. `hand: raise` shows `handRaised` (and the **Take question** button) until `hand: lower`.
- `confused`, `bored` and `happy` are frontend-only moods; the backend never sends them.
- Alert toasts: at most one per alert kind every 12 seconds.
- The browser sends `posture`, `hands` and `eye_contact` from `frontend/src/vision`, and `too_quiet` from Web Audio. `too_fast` and `filler` need streaming speech-to-text (`WS /stream`, not built).

## 3. Needed by the frontend, not in the backend

- `target_length_sec` and `script` on `POST /sessions` (timing, script coverage).
- `body_language` in `scores`, the `criteria` array, and the extra metrics (`hedge_count`, `audible_pct`, `eye_contact_pct`, `posture_alerts`, `duration_sec`, `target_length_sec`).
- `overall` computed in code from the `RUBRIC.md` weights (today Gemini returns it).
- `hand: raise` events and a question endpoint for the mascot Q&A, plus scoring of the answer.
- Interview and debate flows (question generation, rebuttals).
- Nothing else for sessions: `session_id`, saved results and history scores are now in the backend.
- Word timestamps in the `/speech` response (for a timeline).
- Live pace and volume numbers (`WS /stream`).

## 4. Frontend work that depends on this

The Start screen asks for a speaker name; no setup screen creates a session yet, so `createSession` is only called by the dev recording tool. The Results screen shows a `POST /speech` response (router state), a saved session at `/results/:session_id`, or the mock at `/results` when `useMocks` is true.

## 5. Dev tools

In development only: Home shows a dev mood bar, and `/results` shows a "Dev mock" bar that switches between the mock results (all 13 criteria, no camera or script, scores only). Recording a real speech is done on the practice session screen.

## 6. Where the backend code and the docs disagree

| Topic | Docs say | Backend code does | Followed |
|---|---|---|---|
| Metric names | `RUBRIC.md` and the design doc database use `filler_count`, `pause_count`, `longest_pause_sec`; the event contract table uses `fillers`, `pauses` | returns `fillers`, `pauses`, `longest_pause`, `speaking_time`, `wpm`, `filler_list` | backend |
| Duration | `duration_sec` | returns `speaking_time`; the transcription `duration` is not in the response | backend, `duration_sec` kept as optional "not returned yet" |
| `scores` | six keys including `body_language` (`RUBRIC.md`) | five keys, no `body_language`; the Gemini schema has the same five | backend, `body_language` optional |
| `criteria` | optional array in the feedback | not present | optional |
| `overall` | computed in code from weights (`RUBRIC.md`) | Gemini returns it | backend |
| Speech-to-text | design doc: nova-3 | nova-2 (nova-3 drops "um" and "uh") | backend |
| Sessions input | `RUBRIC.md`: `target_length_sec`, `script` | only `speaker`, `mode`, `topic` | backend |
| Storage | Postgres | Postgres when `DATABASE_URL` is set, else in memory (lost on restart); a failed save returns `saved: false` instead of an error; `schemas.py` is empty | backend |
| Session results | `GET /sessions/{id}` returns full results | now does: `results` holds `transcript`, `metrics`, `feedback` once `/speech` ran with the `session_id` | match |
| Vision stats | merged into the metrics | `vision` form field with `posture_alerts`, `hands_alerts`, `eye_contact_alerts`, `eye_contact_pct`; the browser must tally them from the alerts | backend |
| Text-to-speech | Deepgram Aura / browser | none; the browser would speak `robot_line` | backend |
| AI provider | Gemini or Muse switch | `AI_PROVIDER=muse` raises `NotImplementedError` | backend |
| Gemini models | one model | tries `gemini-3.5-flash-lite`, `gemini-3.8-flash`, `gemini-2.5-flash` in order | backend |
| Error handling | none described | `/speech` returns 400, 422 or 502; sends `lcd: "Try again"` on failure; always ends with `state: idle` | backend |
| Event timing | `state: thinking` then results | after a successful run `state: idle` is sent last, from a `finally` block | backend |
| `listening` / `hand` / `alert` | server sends them | server never sends them (relay only) | backend |
| Frontend framework | design doc: Ionic (the architecture diagram says Next.js) | n/a, the frontend is React + Vite | n/a |
| Vision alert values | design doc lists `posture`, `hands`, `eye_contact` | the vision module emits exactly those three | match |
