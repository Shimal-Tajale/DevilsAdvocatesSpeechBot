import asyncio

from fastapi import WebSocket

clients: set[WebSocket] = set()

# Bumped on every state event, so a delayed one can tell it has been overtaken.
state_changes = 0
_delayed: set[asyncio.Task] = set()  # keeps background tasks from being garbage-collected

async def broadcast(event: dict):
    global state_changes
    if event.get("type") == "state":
        state_changes += 1
    for ws in list(clients):
        try:
            await ws.send_json(event)
        except Exception:
            clients.discard(ws)

def idle_after(seconds: float) -> None:
    """Send state: idle after `seconds`, unless another state change happens first
    (e.g. the next recording starting), so it never interrupts anything."""
    expected = state_changes

    async def later():
        await asyncio.sleep(seconds)
        if state_changes == expected:
            await broadcast({"type": "state", "value": "idle"})

    task = asyncio.create_task(later())
    _delayed.add(task)
    task.add_done_callback(_delayed.discard)
