
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from backend.events import clients, broadcast
from backend.pipeline import run_session
from backend.routes import sessions

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
            event = await ws.receive_json()
            await broadcast(event)
    except WebSocketDisconnect:
        clients.discard(ws)

@app.post("/speech")
async def speech(audio: UploadFile = File(...)):
    return await run_session(await audio.read())

@app.post("/test/{type}/{value}")
async def test_event(type: str, value: str):
    event = {"type": type, "value": value}
    await broadcast(event)
    return {"sent": event, "clients": len(clients)}