import asyncio

from backend.events import broadcast

# Stub: every step returns fake data in the real shape, so the frontend,
# robot and routes can integrate before Deepgram / AI / Postgres are wired.

FAKE_TRANSCRIPT = "Um, so today I want to talk about, uh, why sleep matters."


async def transcribe(audio: bytes) -> dict:
    return {"transcript": FAKE_TRANSCRIPT, "words": []}


def compute_metrics(transcription: dict) -> dict:
    return {
        "wpm": 142,
        "fillers": 2,
        "filler_list": ["um", "uh"],
        "pauses": 1,
        "longest_pause": 2.4,
        "speaking_time": 45.0,
    }


async def get_feedback(transcript: str, metrics: dict) -> dict:
    return {
        "scores": {"structure": 7, "clarity": 8, "delivery": 6,
                   "persuasion": 7, "confidence": 6},
        "overall": 68,
        "strengths": ["Strong opening hook"],
        "fixes": ["Cut 'um' before key points", "Pause after your main claim"],
        "robot_line": "Great hook! Next time, slow down in the middle.",
    }


async def save_session(result: dict) -> None:
    pass


async def run_session(audio: bytes, vision: dict | None = None) -> dict:
    await broadcast({"type": "state", "value": "thinking"})
    await asyncio.sleep(1)  # stand-in for API latency so "thinking" is visible

    transcription = await transcribe(audio)
    metrics = compute_metrics(transcription)
    metrics.update(vision or {})

    feedback = await get_feedback(transcription["transcript"], metrics)

    await broadcast({"type": "metrics", "value": metrics})
    await broadcast({"type": "feedback", "value": feedback})
    await broadcast({"type": "lcd", "value": f"Score: {feedback['overall']}/100"})
    await broadcast({"type": "state", "value": "speaking"})

    # TTS of robot_line goes here; until then the browser speaks it.

    result = {"transcript": transcription["transcript"],
              "metrics": metrics, "feedback": feedback}
    await save_session(result)
    await broadcast({"type": "state", "value": "idle"})
    return result
