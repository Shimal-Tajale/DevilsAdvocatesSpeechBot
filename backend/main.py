
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
from backend.pipeline import NoSpeechError, VisionStats, run_session
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
                 vision: str | None = Form(None, description="VisionStats as a JSON string")):
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
        return await run_session(data, stats, session)
    except NoSpeechError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("Speech pipeline failed")
        raise HTTPException(status_code=502, detail=f"Speech analysis failed: {e}")

@app.post("/test/{type}/{value}")
async def test_event(type: str, value: str):
    event = {"type": type, "value": value}
    await broadcast(event)
    return {"sent": event, "clients": len(clients)}