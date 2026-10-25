"""Process-local session storage; data is lost when the server restarts."""

from uuid import UUID, uuid4

from backend.models.sessions import Session, SessionCreate


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[UUID, Session] = {}

    def create(self, data: SessionCreate) -> Session:
        session = Session(session_id=uuid4(), **data.model_dump())
        self._sessions[session.session_id] = session
        return session

    def get(self, session_id: UUID) -> Session | None:
        return self._sessions.get(session_id)

    def history(self, speaker: str) -> list[Session]:
        return [s for s in self._sessions.values() if s.speaker == speaker]

    def save_results(self, session_id: UUID, result: dict) -> None:
        session = self._sessions[session_id]
        self._sessions[session_id] = session.model_copy(update={"results": {
            k: result[k] for k in ("transcript", "metrics", "feedback")}})
