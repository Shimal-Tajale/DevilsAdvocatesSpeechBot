# All Ears

An AI speech coach with an audience that reacts while you talk. Built in 24 hours at
HackTX 2026, where it placed 2nd for Best Use of SerpApi.

While you present, All Ears watches your posture, gestures and eye contact through the
webcam and reacts live: on screen, through Earnest the bunny mascot, and through a small
Arduino robot that flashes, beeps and shows what you're doing on its LCD. When you finish,
it scores your pace and filler words, gives feedback, and Earnest asks you a question
about a claim you made, backed by a real source found with SerpApi.

[Devpost](https://devpost.com/software/speechbot-29k8wc) · [Feature list](docs/FEATURES.md)

## How it works

```
Browser (React + MediaPipe) ──/events WebSocket──> FastAPI hub ──WebSocket──> bridge.py ──USB serial──> Arduino Mega
        │                                              │
        └──── POST /speech (recording) ────────────────┴─> Deepgram (transcript)
                                                           ─> metrics in Python (pace, fillers, pauses)
                                                           ─> Gemini (feedback) ─> Postgres / Supabase
```

- **Live:** MediaPipe runs in the browser and sends alerts (slouching, swaying, hands in
  pockets, fidgeting, looking away) to the hub, which broadcasts them to every screen and
  to the robot. All events are JSON: `{"type": "...", "value": ...}`.
- **After the speech:** the recording goes to `POST /speech`. Deepgram nova-2 transcribes
  it (nova-3 drops "um" and "uh"), Python measures the numbers, and Gemini writes feedback
  grounded in them.
- **Audience question:** `POST /sessions/{id}/question` picks a claim, searches it with
  SerpApi and asks about it. Debate mode argues back using two searches; interview mode
  asks about the speaker. You can record one answer and get it rated out of 10.

## Modes

| Mode | After the speech |
| --- | --- |
| Presentation | A question about one of your claims, with its source |
| Debate | A counter-argument backed by two sources |
| Interview | A follow-up question about you |

## Run it locally

Needs Python 3.12+, Node 20+, and API keys for Deepgram, Gemini and SerpApi.

```sh
cp .env.example .env            # then fill in the keys
python -m venv backend/venv
backend/venv/Scripts/pip install -r backend/requirements.txt   # bin/pip on macOS/Linux
cd frontend && npm install && cd ..
```

On Windows, `start.bat` starts everything, each part in its own window:

```
start.bat                 backend (:8000) + frontend (:80)
start.bat robot           + the Arduino bridge
start.bat dry-run         + the bridge without a robot (prints what it would send)
start.bat ngrok           + an https tunnel, for phones
```

Elsewhere, run the two halves yourself from the repo root:

```sh
uvicorn backend.main:app --port 8000
cd frontend && npm run dev      # Vite proxies /api and /ws to :8000
```

Without `DATABASE_URL`, sessions are kept in memory. The robot is optional: Earnest
reacts to the same events on screen.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `DEEPGRAM_API_KEY` | Transcription |
| `GEMINI_API_KEY` | Feedback, questions and answer ratings |
| `SERPAPI_API_KEY` | Sources for the audience question |
| `DATABASE_URL` | Postgres (e.g. Supabase); optional |
| `DEEPGRAM_KEYWORDS` | Extra words to transcribe correctly, comma-separated; optional |
| `SERIAL_PORT` | The Arduino's port for the bridge (found automatically if wrong) |
| `EVENTS_URL` | Where the bridge connects; default `ws://localhost:8000/events` |
| `ENABLE_TEST_EVENTS` | `1` enables `POST /test/{type}/{value}` for sending events by hand |
| `APP_ACCESS_CODE` | Password-protects a deployed site; optional (`deploy/render` only) |
| `MAX_UPLOAD_MB` | Upload limit, default 50 (`deploy/render` only) |

## The robot

Upload [hardware/robot/robot.ino](hardware/robot/robot.ino) to an Arduino Mega once from
the Arduino IDE (it needs the LiquidCrystal library). The bridge sends it one line per
event at 9600 baud: `S:<state>`, `A:<alert>`, `L:<text>` and `H:1`/`H:0`.

| LED | Meaning |
| --- | --- |
| White | Idle |
| Blue | Listening |
| Flashing yellow | Thinking |
| Green | Speaking |
| Red flash and a beep | An alert, named on the LCD |

```sh
pip install -r bridge/requirements.txt
python bridge/bridge.py            # add --dry-run to test without the robot
```

## Deploy (Render)

The `deploy/render` branch serves the built frontend from the backend, so one URL is the
whole app. It's a free Render web service with:

- **Build:** `pip install -r backend/requirements.txt`
- **Start:** `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
- **Environment:** the keys above; leave `ENABLE_TEST_EVENTS` unset.

To point a local robot at it, set
`EVENTS_URL=wss://<name>:<access code>@<service>.onrender.com/events`, or drop
`<name>:<access code>@` if the site has no access code. The free tier sleeps when idle,
so open the site a minute before a demo.

## Repo layout

| Path | What |
| --- | --- |
| `backend/` | FastAPI hub, speech pipeline, sessions, database |
| `frontend/` | React + TypeScript + Vite app; MediaPipe vision in `src/vision` |
| `bridge/` | WebSocket-to-serial bridge for the robot |
| `hardware/robot/` | Arduino sketch |
| `docs/` | Design doc, feature list, event contract |

## Team

- **Shimal Tajale**: team lead, architecture and event contracts, FastAPI backend and
  speech pipeline, SerpApi question, database, robot bridge, integration, co-presented
  the pitch
- **Abhiram Jetty**: the app experience, Earnest and the All Ears brand, scoring rubric
- **Kundansai Ampagowni**: MediaPipe posture and eye-contact detection, session API, co-presented
  the pitch
- **Abhijay Patchala**: the robot's hardware and firmware
