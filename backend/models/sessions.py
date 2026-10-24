"""Validated inputs and responses for the session API."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SessionCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    speaker: str = Field(min_length=1)
    mode: str = Field(min_length=1)
    topic: str = Field(min_length=1)


class Session(SessionCreate):
    session_id: UUID
