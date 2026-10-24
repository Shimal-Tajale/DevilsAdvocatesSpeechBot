"""Session endpoints backed by temporary in-memory storage."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from backend.models.sessions import Session, SessionCreate
from backend.stores.sessions import SessionStore

router = APIRouter(tags=["sessions"])
_store = SessionStore()


def get_session_store() -> SessionStore:
    return _store


@router.post("/sessions", response_model=Session, status_code=status.HTTP_201_CREATED)
def create_session(
    data: SessionCreate, store: SessionStore = Depends(get_session_store)
) -> Session:
    return store.create(data)


@router.get("/sessions/{session_id}", response_model=Session)
def get_session(
    session_id: UUID, store: SessionStore = Depends(get_session_store)
) -> Session:
    session = store.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.get("/history/{speaker}", response_model=list[Session])
def get_history(
    speaker: str, store: SessionStore = Depends(get_session_store)
) -> list[Session]:
    return store.history(speaker)
