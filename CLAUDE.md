# Project brief: AI speech coach (hackathon frontend)

Read this fully before writing any code. It is the source of truth for the project.

## What we're building

A web app that helps people practice and analyze their **public speaking**, **debate**, and **interview** skills. A cute animated mascot acts as the audience, coach, or opponent. The user records themselves, gets live and end-of-session feedback, and sees a score for each skill.

This is a 12-hour hackathon. The Python backend (speech analysis, LLM calls) is built by teammates. **I am building the frontend only.**

## Hard rules for this repo

1. **Frontend only, no real functionality.** Buttons navigate and trigger animations, but do not call any real backend. All data comes from mock functions.
2. **All backend access goes through one file: `src/api.ts`.** Every function in it returns mock data (with a short fake delay). Later, my teammates' endpoints replace the mock bodies and nothing else changes. Never call `fetch` from components.
3. **Everything is modular and removable.** Not every feature will get finished. A single `src/features.ts` config controls what shows up, for example:
   ```ts
   export const features = {
     modes: { publicSpeaking: true, debate: true, interview: true },
     liveIndicators: true,
     mascotQuestions: true,
     scriptUpload: true,
     noteCards: true,
     cameraPreview: true,
     history: false,
   };
   ```
   Turning a flag off must cleanly hide the nav item, panel, or button. Features that are off but planned show a "Coming soon" badge on the home screen.
4. **Shared components, thin screens.** Each mode is a configuration of shared components, not a copy-pasted page.
5. **Commit-friendly.** Build one screen or component at a time, keep the app runnable after every step, and tell me what to look at.

## Tech stack

- React + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- Framer Motion for animation
- React Router
- Mascot is an SVG React component (see below)
- No backend code in this repo

The backend will be Python (probably FastAPI). Plan for HTTP + WebSocket (live indicators), but only mock it for now.

## Dev server and hosting

The app runs on **localhost port 80** and is shared with phones and teammates through **ngrok** (`ngrok http 80`). ngrok provides an HTTPS URL, which browsers require for mic and camera access on any device other than localhost.

Configure the `server` block in `vite.config.ts` like this:

```ts
server: {
  port: 80,
  strictPort: true,   // fail loudly instead of silently picking another port
  host: true,
  allowedHosts: true, // lets the ngrok hostname through (hackathon only)
  proxy: {
    '/api': { target: 'http://localhost:8000', changeOrigin: true },
    '/ws':  { target: 'ws://localhost:8000', ws: true },
  },
},
```

Rules that follow from this setup:

- Only port 80 is exposed through ngrok, so the browser must **never call the backend directly**. `api.ts` uses relative URLs (`/api/...`, `/ws/...`) and the Vite proxy forwards them to the Python backend. Build WebSocket URLs from `window.location` (`wss://` when the page is served over https, `ws://` otherwise).
- Never hardcode `localhost` or port numbers in components or in `api.ts`.
- The backend port above (8000) is a placeholder: **[FILL IN once teammates confirm]**, along with the `/api` and `/ws` prefixes.
- Everything is mocked for now. The proxy is configured so that swapping in real endpoints later requires no frontend config changes.
- If hot reload misbehaves through ngrok, add `hmr: { clientPort: 443 }` to the `server` block.
- If port 80 fails (permission denied or already in use), tell me instead of silently changing the port.

## Core loop (all three modes share it)

Setup, then Session (record), then Mascot response, then Results.

- **Public speaking:** speak, then mascot Q&A, then report.
- **Interview:** (question, then answer) repeated N times, then report.
- **Debate:** your argument, then opponent rebuttal, then your rebuttal, then report.

## Screens

1. **Home:** mascot greeting, three mode cards (Public Speaking, Debate, Interview), friendly mic/camera permission prompt.
2. **Setup (per mode):**
   - Public speaking: topic, target length, optional script upload or paste.
   - Debate: the motion, which side the user takes, opponent difficulty.
   - Interview: paste a job description (primary input), optional company, role, question types, number of questions, and feedback timing (after each question or at the end).
3. **Live session:** mascot front and center, optional small camera preview, indicator rail, timer, note cards, big stop button.
4. **Response phase:** see "Mascot behavior".
5. **Results:** overall score, category scores, per-criterion scores, highlighted transcript, timeline with markers, top tips (strength first).
6. **History/progress:** stretch goal, behind a feature flag.

## Mascot behavior (important)

The mascot is one component: `<Mascot mood={...} />`. The `mood` prop is the only thing that drives it, so the backend can control it later.

Moods: `idle`, `listening`, `confused`, `bored`, `handRaised`, `speaking`, `happy`, `thinking`.

**While the user speaks:** mascot is `listening`. Moods react to indicators: it tilts its head on a filler word, looks `bored` or `confused` when the user drifts off-topic, and looks `happy` when things are going well.

**After the user finishes (public speaking mode):**

1. The mascot does **not** speak on its own. It raises its hand (`handRaised`) and waits.
2. The user clicks the mascot ("call on them").
3. Only then does the mascot go to `speaking`, and a text box appears with the written version of its question (a speech bubble or caption panel).
4. The user records an answer.
5. Repeat if there are more questions, or continue to Results.

In interview and debate modes the mascot speaks when it is its turn, since those flows are structured turn by turn.

Cosmetic extras: a costume per mode (glasses and podium for speaking, tie for interview, gavel for debate).

Mascot design: **[FILL IN once picked: animal/character, colors, personality]**. Until then, build a simple friendly SVG blob with big eyes and animate moods with Framer Motion. Keep the art simple so it's easy to swap.

## Live indicators (public speaking, debate)

Show only four during the session, and keep the screen calm when things are fine: indicators stay faded and only pulse when something needs attention. Everything else is report-only.

| Indicator | Live behavior |
|---|---|
| Filler words | Small counter ticks up, mascot tilts head |
| Pace | Mini speedometer, amber/red when too fast or slow |
| Volume | Volume meter |
| Eye contact | Mascot looks back at you, or looks away |

Include a **focus mode** toggle that hides all live feedback and saves it for the report.

## Scoring criteria (public speaking report)

Each criterion is scored 0-100. Categories get a rolled-up score, plus a weighted overall score. Use friendly labels ("Nailed it", "Getting there", "Focus here") instead of harsh red numbers.

| Category | Criterion | Measures |
|---|---|---|
| Voice | Filler words | um, uh, like, you know per minute |
| Voice | Pace | Words per minute, ideal range roughly 130-160 |
| Voice | Volume | Audible and consistent |
| Voice | Vocal variety | Pitch variation, monotone vs. expressive |
| Voice | Pauses | Deliberate pauses vs. dead air |
| Body | Eye contact | % of time looking at the camera |
| Body | Posture | Upright, steady, minimal swaying |
| Content | Relevance | Staying on topic |
| Content | Structure | Clear intro, body, conclusion |
| Content | Script coverage | Key points from the provided script covered |
| Content | Confident language | Fewer hedges ("I think maybe", "sort of") |
| Content | Timing | Actual vs. target length |

Interview extras: STAR method breakdown for behavioral answers (Situation, Task, Action, Result, showing which were missing) and a topic proficiency radar chart.
Debate extras: per-round feedback, optional argument map showing which claims were rebutted.

## Results screen details

- Overall score ring at the top, then category cards, then per-criterion rows with a one-line detail and one tip each.
- **Highlighted transcript:** filler words and hedges highlighted inline, clickable.
- Timeline of the session with markers where issues occurred.
- Always lead with a strength before weaknesses.

## Data contracts (mock these in `src/api.ts`)

```json
// Results
{
  "overall": 78,
  "categories": [{ "id": "voice", "score": 71 }],
  "criteria": [
    { "id": "filler_words", "category": "voice", "score": 64,
      "detail": "14 fillers (5.2/min)", "tip": "Try pausing instead of saying 'um'." }
  ],
  "transcript": [{ "start": 3.2, "text": "um", "flag": "filler" }],
  "questions": ["You mentioned X. Can you expand on that?"]
}

// Live indicator event (would arrive over WebSocket)
{ "type": "indicator", "id": "pace", "value": 172, "status": "warn" }

// Mascot mood event
{ "type": "mood", "value": "handRaised" }
```

TypeScript types for these live in `src/types.ts`. Keep them in sync with this doc.

## Design direction

- Friendly, encouraging, approachable. Never intimidating or clinical.
- Rounded shapes, generous spacing, one memorable element (the mascot).
- Make deliberate choices for palette and typography specific to this product rather than generic defaults: **[FILL IN palette and font choices once decided]**.
- Motion should respond to user actions or mascot state, not decorate every element.
- Plain, supportive copy in sentence case, with buttons that say exactly what they do ("Start speaking", "Call on mascot", "See results").
- Responsive down to phone width (users may be on a phone), visible keyboard focus, respect reduced motion.

## Build order (cut from the bottom if time runs out)

1. Scaffold: routing, `features.ts`, `api.ts` mocks, `types.ts`, theme
2. Home + Mascot component with all moods
3. Public speaking: setup, session screen with recording UI (fake), results screen
4. Live indicator rail
5. Hand-raise Q&A flow
6. Interview mode (reuses Q&A flow)
7. Debate mode
8. Script/note cards, history, polish

## Working style

- Ask me before making big structural decisions that this doc doesn't cover.
- After each step, summarize what you built and how to see it.
- Don't add libraries beyond the stack above without asking.
- Don't build real audio analysis, speech-to-text, or LLM calls. Mock everything.
