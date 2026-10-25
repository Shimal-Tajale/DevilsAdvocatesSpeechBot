# Speech Coach Bot: features

What works today, how to try it, and what it needs. Start everything from the repo
root with `.\start.bat` (add `ngrok` for phones, `robot` for the Arduino bridge).

## Speech analysis (`POST /speech`)
- **Transcript** from Deepgram nova-2, which keeps filler words (nova-3 drops them).
- **Names spelled right**: the speaker's name and topic words are boosted; add fixed
  ones (team names, "HackTX") with `DEEPGRAM_KEYWORDS` in `.env`.
- **Measured metrics**: words per minute, filler words (um, uh, comma-set "like" and
  "you know"), pauses over 2 s, longest pause, speaking time.
- **AI feedback** from Gemini: 5 scores, overall score, strengths, fixes, and a line the
  robot says. Falls back to another Gemini model if one is overloaded.
- **Accepts** webm, mp4, m4a, wav, and video files (their audio is used).
- **Saved to Supabase** when `DATABASE_URL` is set; `GET /sessions/{id}` returns results.

## Live coaching while you speak (camera)
- **Camera preview** with an optional skeleton overlay and live detector status.
- **Calibration hints** say what's blocking it (e.g. "Step back until your hips are in
  the picture"). Needs ~3 s standing still with face, shoulders and hips in view.
- **Detects** slouching, swaying, hands in pockets, fidgeting, and looking away.
  Each has its own 12 s cooldown.
- **Reactions**: a specific toast ("Plant your feet and stay steady"), Earnest the mascot
  reacts (bored or confused), and the robot flashes red, beeps and shows e.g.
  `! Slouching` on its LCD.

## Report (Results screen)
- Overall score, category scores, strengths, fixes, transcript with fillers highlighted.
- **Body language** tally: % facing the camera, times looked away, slouching, swaying,
  hands in pockets, fidgeting.

## Audience question (SerpApi)
- After a speech, the robot and mascot raise their hand. **Take question** runs one
  Google search via SerpApi and Earnest asks a sharp question about a claim from the
  speech, with its source, read aloud. Needs `SERPAPI_API_KEY` in `.env` (without it, the
  question has no source).
- **Answer it**: record one answer; it's rated 0-10 (did you answer, did well, try next)
  with a transcript of the question and your answer. The robot shows `Answer: N/10`.

## Repeatable demo (record once, replay any time)
- After a live recording, **Download video** saves camera + mic as one file.
- **Upload a recording** then **Play with live coaching**: the video plays with sound
  while vision watches it, so toasts, mascot and robot react in sync; **Analyze**
  includes body language. Start recordings with ~3 s standing still, hips in frame.

## Robot (Arduino Mega)
- LED: white idle, blue listening, yellow thinking, green speaking, red flash on alerts.
- LCD: scores and the specific alert (`! Slouching`, `! Looking away`); buzzer beeps.
- Button on pin 2 sends "someone stepped up".
- **Bridge** (`bridge/bridge.py`) reconnects to the Arduino by itself, finds the board if
  its port changes, and prints every line it sends. To run it on another laptop, set
  `EVENTS_URL=wss://<your-ngrok-link>/ws/events`.
- Upload `hardware/robot/robot.ino` once from the Arduino IDE (needs the LiquidCrystal
  library); it stays on the board.

## Setup reminders
- `.env` keys: see `.env.example` (Deepgram, Gemini, Supabase, SerpApi, optional
  `DEEPGRAM_KEYWORDS`, `SERIAL_PORT`).
- After pulling: `pip install -r backend/requirements.txt` and `npm install` in `frontend/`.
- No hardware? Everything works without the robot; the mascot covers the same events.
