
from dotenv import load_dotenv
load_dotenv()

import asyncio
import logging
from uuid import UUID

from fastapi import (FastAPI, File, Form, HTTPException, UploadFile, WebSocket,
                     WebSocketDisconnect)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from backend.events import clients, broadcast
from backend.pipeline import NoSpeechError, VisionStats, ask_question, rate_answer, run_session
from backend.routes import sessions

logger = logging.getLogger(__name__)

app = FastAPI(title="Devil's Advocates Speech Bot")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(sessions.router)

@app.websocket("/events")
async def events_ws(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        while True:
            try:
                event = await ws.receive_json()
            except ValueError:  # not JSON: skip it, keep the client connected
                continue
            await broadcast(event)
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)

@app.post("/speech")
async def speech(audio: UploadFile = File(...),
                 session_id: UUID | None = Form(None),
                 vision: str | None = Form(None, description="VisionStats as a JSON string"),
                 target_length_sec: int | None = Form(None, gt=0, le=3 * 60 * 60)):
    session = None
    if session_id:
        # Blocking DB call: keep it off the event loop so /events stays live.
        found = await asyncio.to_thread(sessions.get_session_store().get, session_id)
        if found is None:
            raise HTTPException(status_code=404, detail="Session not found")
        session = found.model_dump(mode="json")
    try:
        stats = VisionStats.model_validate_json(vision) if vision else None
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=f"Invalid vision stats: {e}")

    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty audio file")
    try:
        return await run_session(data, stats, session, target_length_sec)
    except NoSpeechError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("Speech pipeline failed")
        raise HTTPException(status_code=502, detail=f"Speech analysis failed: {e}")

# The robot's audience question, asked when the speaker calls on it after the speech.
# One web search per call, so the frontend only calls it on request.
@app.post("/sessions/{session_id}/question")
async def question(session_id: UUID):
    found = await asyncio.to_thread(sessions.get_session_store().get, session_id)
    if found is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if found.results is None:
        raise HTTPException(status_code=409, detail="Record a speech for this session first")
    try:
        asked = await ask_question(found.model_dump(mode="json"), found.results)
    except Exception as e:
        logger.exception("Question failed")
        raise HTTPException(status_code=502, detail=f"Could not come up with a question: {e}")
    await broadcast({"type": "hand", "value": "lower"})  # called on: hand down, then ask
    return asked

# The speaker's recorded answer to that question, rated once. The question text comes
# from the client, which got it from /question (questions aren't stored).
@app.post("/sessions/{session_id}/answer")
async def answer(session_id: UUID, audio: UploadFile = File(...),
                 question: str = Form(...), claim: str = Form("")):
    found = await asyncio.to_thread(sessions.get_session_store().get, session_id)
    if found is None:
        raise HTTPException(status_code=404, detail="Session not found")
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty audio file")
    try:
        return await rate_answer(data, question, claim, found.model_dump(mode="json"))
    except NoSpeechError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("Answer rating failed")
        raise HTTPException(status_code=502, detail=f"Could not rate the answer: {e}")

@app.post("/test/{type}/{value}")
async def test_event(type: str, value: str):
    event = {"type": type, "value": value}
    await broadcast(event)
    return {"sent": event, "clients": len(clients)}