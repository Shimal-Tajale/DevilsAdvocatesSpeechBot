"""Hosting layer: lets one server (e.g. Render) be the whole site.

- Serves the built frontend (frontend/dist) with a fallback to index.html,
  so React Router paths like /results/<id> survive a page reload.
- Accepts the frontend's /api/... and /ws/... paths by stripping the prefix,
  the same rewrite the Vite dev proxy does locally.
- APP_ACCESS_CODE (optional): password-protects everything with the browser's
  login prompt (any username). A cookie remembers it, so the WebSocket and
  later requests get through too. The robot bridge logs in through its URL:
  EVENTS_URL=wss://anyname:<code>@<host>/events
- MAX_UPLOAD_MB (default 50): rejects bigger uploads before they are read,
  since recordings are held in memory on a small instance.

Locally none of this changes anything: no dist folder, no access code.
"""

import base64
import hashlib
import hmac
import os
from http.cookies import SimpleCookie
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse

DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
PREFIXES = ("/api", "/ws")
COOKIE = "allears_access"


class HostingMiddleware:
    def __init__(self, app, access_code: str = "", max_upload_mb: int = 50):
        self.app = app
        self.code = access_code
        # The cookie holds a hash of the code, never the code itself.
        self.token = hashlib.sha256(f"allears:{access_code}".encode()).hexdigest()
        self.max_bytes = max_upload_mb * 1024 * 1024

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)

        path = scope["path"]
        for prefix in PREFIXES:
            if path == prefix or path.startswith(prefix + "/"):
                path = path[len(prefix):] or "/"
                scope = dict(scope, path=path, raw_path=path.encode())
                break

        headers = {k.decode().lower(): v.decode("latin-1") for k, v in scope["headers"]}

        if self.code:
            has_cookie = SimpleCookie(headers.get("cookie", "")).get(COOKIE)
            if has_cookie and hmac.compare_digest(has_cookie.value, self.token):
                pass
            elif self._basic_ok(headers.get("authorization", "")):
                if scope["type"] == "http":
                    send = self._with_cookie(send)
            elif scope["type"] == "websocket":
                return await send({"type": "websocket.close", "code": 1008})
            else:
                return await self._respond(send, 401, b"Access code required",
                                           [(b"www-authenticate", b'Basic realm="All Ears"')])

        if scope["type"] == "http" and int(headers.get("content-length") or 0) > self.max_bytes:
            return await self._respond(send, 413, b"Recording too large")

        await self.app(scope, receive, send)

    def _basic_ok(self, auth: str) -> bool:
        if not auth.lower().startswith("basic "):
            return False
        try:
            _, _, password = base64.b64decode(auth[6:]).decode().partition(":")
        except ValueError:
            return False
        return hmac.compare_digest(password.encode(), self.code.encode())

    def _with_cookie(self, send):
        cookie = (f"{COOKIE}={self.token}; Path=/; Max-Age=2592000; HttpOnly; Secure; "
                  "SameSite=Lax").encode()

        async def wrapped(message):
            if message["type"] == "http.response.start":
                message = dict(message, headers=[*message.get("headers", []),
                                                 (b"set-cookie", cookie)])
            await send(message)
        return wrapped

    @staticmethod
    async def _respond(send, status: int, body: bytes, headers=()):
        await send({"type": "http.response.start", "status": status,
                    "headers": [(b"content-type", b"text/plain"), *headers]})
        await send({"type": "http.response.body", "body": body})


def install(app: FastAPI) -> None:
    """Call after every API route is registered: the frontend catch-all goes last."""
    app.add_middleware(HostingMiddleware,
                       access_code=os.getenv("APP_ACCESS_CODE", ""),
                       max_upload_mb=int(os.getenv("MAX_UPLOAD_MB", "50")))
    if not (DIST / "index.html").is_file():
        return  # local dev: Vite serves the frontend

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str):
        file = (DIST / path).resolve()
        if path and file.is_file() and file.is_relative_to(DIST):
            return FileResponse(file)
        return FileResponse(DIST / "index.html")
