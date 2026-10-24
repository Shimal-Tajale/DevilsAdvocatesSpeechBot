import os

from deepgram import AsyncDeepgramClient

from backend.events import broadcast

# Steps not yet wired return fake data in the real shape, so the frontend,
# robot and routes can integrate before AI / Postgres are done.

_deepgram: AsyncDeepgramClient | None = None


def _deepgram_client() -> AsyncDeepgramClient:
    global _deepgram
    if _deepgram is None:
        # Read at call time; the SDK's own default is captured at import.
        _deepgram = AsyncDeepgramClient(api_key=os.getenv("DEEPGRAM_API_KEY"))
    return _deepgram


async def transcribe(audio: bytes) -> dict:
    response = await _deepgram_client().listen.v1.media.transcribe_file(
        request=audio, model="nova-3", smart_format=True, filler_words=True)
    alt = response.results.channels[0].alternatives[0]
    return {
        "transcript": alt.transcript,
        "words": [{"word": w.word, "start": w.start, "end": w.end}
                  for w in alt.words],
        "duration": response.metadata.duration,
    }


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
