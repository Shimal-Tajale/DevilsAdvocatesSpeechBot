"""Postgres storage for sessions and their results (schema from the design doc).

Used when DATABASE_URL is set; otherwise the in-memory SessionStore is used,
so tests and offline work need no database.
"""

import atexit
import os
import threading
from uuid import UUID, uuid4

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from backend.models.sessions import Session, SessionCreate
from backend.stores.sessions import SessionStore

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id            uuid PRIMARY KEY,
    speaker       text NOT NULL,
    mode          text NOT NULL,
    topic         text NOT NULL,
    started_at    timestamptz NOT NULL DEFAULT now(),
    overall_score int
);
CREATE INDEX IF NOT EXISTS sessions_speaker ON sessions (speaker, started_at);

CREATE TABLE IF NOT EXISTS metrics (
    session_id      uuid PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
    wpm             int,
    filler_count    int,
    pause_count     int,
    eye_contact_pct real,
    posture_alerts  int,
    data            jsonb NOT NULL  -- the full metrics dict, for the scorecard
);

CREATE TABLE IF NOT EXISTS feedback (
    session_id uuid PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
    scores     jsonb NOT NULL,
    strengths  jsonb NOT NULL,
    fixes      jsonb NOT NULL,
    robot_line text NOT NULL,
    transcript text NOT NULL
);
-- RUBRIC.md's per-criterion scores; added later, so older rows have none.
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS criteria jsonb;
"""

# One query rebuilds a session with its results (results is NULL until /speech runs).
SELECT_SESSIONS = """
SELECT s.id, s.speaker, s.mode, s.topic,
       CASE WHEN f.session_id IS NULL THEN NULL ELSE jsonb_build_object(
           'transcript', f.transcript,
           'metrics', m.data,
           'feedback', jsonb_build_object(
               'scores', f.scores, 'overall', s.overall_score,
               'strengths', f.strengths, 'fixes', f.fixes,
               'robot_line', f.robot_line, 'criteria', f.criteria))
       END AS results
FROM sessions s
LEFT JOIN metrics m ON m.session_id = s.id
LEFT JOIN feedback f ON f.session_id = s.id
"""


def _to_session(row: dict) -> Session:
    return Session(session_id=row["id"], speaker=row["speaker"], mode=row["mode"],
                   topic=row["topic"], results=row["results"])


class PostgresSessionStore:
    """Same methods as SessionStore, backed by Postgres."""

    def __init__(self, url: str) -> None:
        # Opened on first use, so the server still starts if the database is down.
        self._url = url
        self._pool: ConnectionPool | None = None
        self._lock = threading.Lock()  # sync routes run in a thread pool

    def _connect(self):
        with self._lock:
            if self._pool is None:
                # timeout: fail in 5 s rather than hang a request for the default 30 s.
                # prepare_threshold=None: Supabase's transaction pooler (port 6543)
                # rejects the prepared statements psycopg would otherwise reuse.
                pool = ConnectionPool(self._url, min_size=1, max_size=5, open=True, timeout=5,
                                      kwargs={"autocommit": True, "row_factory": dict_row,
                                              "prepare_threshold": None})
                try:
                    with pool.connection() as conn:
                        conn.execute(SCHEMA)
                except Exception:
                    pool.close(timeout=0)  # retry from scratch on the next request
                    raise
                self._pool = pool
                atexit.register(pool.close)  # else Ctrl+C on uvicorn prints a traceback
        return self._pool.connection()

    def create(self, data: SessionCreate) -> Session:
        session = Session(session_id=uuid4(), **data.model_dump())
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO sessions (id, speaker, mode, topic) VALUES (%s, %s, %s, %s)",
                (session.session_id, session.speaker, session.mode, session.topic))
        return session

    def get(self, session_id: UUID) -> Session | None:
        with self._connect() as conn:
            row = conn.execute(SELECT_SESSIONS + "WHERE s.id = %s", (session_id,)).fetchone()
        return _to_session(row) if row else None

    def history(self, speaker: str) -> list[Session]:
        with self._connect() as conn:
            rows = conn.execute(SELECT_SESSIONS + "WHERE s.speaker = %s ORDER BY s.started_at",
                                (speaker,)).fetchall()
        return [_to_session(r) for r in rows]

    def save_results(self, session_id: UUID, result: dict) -> None:
        """Store one speech's results; recording again replaces the previous ones."""
        m, f = result["metrics"], result["feedback"]
        with self._connect() as conn, conn.transaction():
            conn.execute("UPDATE sessions SET overall_score = %s WHERE id = %s",
                         (f["overall"], session_id))
            conn.execute(
                """INSERT INTO metrics (session_id, wpm, filler_count, pause_count,
                                        eye_contact_pct, posture_alerts, data)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (session_id) DO UPDATE SET
                       wpm = EXCLUDED.wpm, filler_count = EXCLUDED.filler_count,
                       pause_count = EXCLUDED.pause_count,
                       eye_contact_pct = EXCLUDED.eye_contact_pct,
                       posture_alerts = EXCLUDED.posture_alerts, data = EXCLUDED.data""",
                (session_id, m["wpm"], m["fillers"], m["pauses"],
                 m.get("eye_contact_pct"), m.get("posture_alerts"), Jsonb(m)))
            conn.execute(
                """INSERT INTO feedback (session_id, scores, strengths, fixes,
                                         robot_line, transcript, criteria)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (session_id) DO UPDATE SET
                       scores = EXCLUDED.scores, strengths = EXCLUDED.strengths,
                       fixes = EXCLUDED.fixes, robot_line = EXCLUDED.robot_line,
                       transcript = EXCLUDED.transcript, criteria = EXCLUDED.criteria""",
                (session_id, Jsonb(f["scores"]), Jsonb(f["strengths"]), Jsonb(f["fixes"]),
                 f["robot_line"], result["transcript"],
                 Jsonb(f["criteria"]) if f.get("criteria") is not None else None))


def create_store() -> SessionStore | PostgresSessionStore:
    url = os.getenv("DATABASE_URL")
    return PostgresSessionStore(url) if url else SessionStore()
