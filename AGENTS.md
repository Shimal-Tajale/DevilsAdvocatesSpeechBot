# Speech Coach Bot — Codex Instructions

## Project Goal
Build an AI-powered robotic speech coach for a 24-hour hackathon.

The MVP should work end-to-end by hour 12.
Feature freeze begins at hour 18.

## Technology Stack
- Frontend: React, TypeScript, Vite
- Backend: Python 3.12, FastAPI
- Database: PostgreSQL (SQLite fallback)
- Computer Vision: MediaPipe
- Speech-to-Text: Deepgram
- AI Feedback: Meta Muse Spark / Gemini
- Text-to-Speech: Deepgram Aura or browser TTS
- Hardware: Arduino Mega
- Communication: REST API, WebSockets, USB Serial

## System Architecture
1. React captures microphone audio and webcam video.
2. MediaPipe analyzes posture and body language in the browser.
3. Live alerts are sent to FastAPI through WebSockets.
4. FastAPI broadcasts events to connected clients.
5. After recording, React uploads audio to POST /speech.
6. Backend transcribes audio using Deepgram.
7. AI generates coaching feedback.
8. Results are saved to the database.
9. React displays a scorecard.
10. Arduino robot reacts through the Python serial bridge.

## Backend API
- POST /sessions: Create a speech session.
- GET /sessions/{session_id}: Retrieve session details.
- GET /history/{speaker}: Retrieve session history.
- POST /speech: Analyze a recording.
- WS /events: Send and receive live events.

## Event Format
All events use JSON:

{"type": "...", "value": ...}

Supported events:
- state
- alert
- lcd
- feedback
- metrics
- hand
- user_present

## Git Rules
- Work on feature/backend-vision.
- Do not switch branches without permission.
- Do not commit, push, or merge without permission.
- Never overwrite teammate-owned files.
- Inspect existing files before modifying them.
- Keep changes small and testable.

## Current Development Responsibilities
- FastAPI session endpoints
- Database models and persistence
- MediaPipe computer vision
- Backend deployment

## File Restrictions
Do not modify these without permission:
- backend/main.py
- backend/pipeline.py
- backend/events.py
- bridge/
- hardware/
- Teammate-owned frontend components

## Development Priorities
1. Working speech-to-feedback pipeline
2. Session API
3. Posture detection
4. Robot integration
5. Deployment

## Codex Workflow
1. Read AGENTS.md before implementing features.
2. Inspect the repository and Git status.
3. Explain the implementation plan.
4. Modify only relevant files.
5. Run tests.
6. Report changes and test results.
7. Do not install unnecessary dependencies.
8. Never hardcode API keys.