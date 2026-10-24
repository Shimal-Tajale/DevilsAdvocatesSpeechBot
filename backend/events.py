from fastapi import WebSocket

clients: set[WebSocket] = set()

async def broadcast(event: dict):
    for ws in list(clients):
        try:
            await ws.send_json(event)
        except Exception:
            clients.discard(ws)