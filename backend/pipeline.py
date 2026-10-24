import json
import os

from deepgram import AsyncDeepgramClient
from google import genai
from google.genai import errors, types
from pydantic import BaseModel

from backend.events import broadcast

# save_session is still a stub until the Postgres side is ready.

_deepgram: AsyncDeepgramClient | None = None


def _deepgram_client() -> AsyncDeepgramClient:
    global _deepgram
    if _deepgram is None:
        # Read at call time; the SDK's own default is captured at import.
        _deepgram = AsyncDeepgramClient(api_key=os.getenv("DEEPGRAM_API_KEY"))
    return _deepgram


async def transcribe(audio: bytes) -> dict:
    # nova-2, not nova-3: nova-3 silently drops um/uh even with filler_words=True.
    response = await _deepgram_client().listen.v1.media.transcribe_file(
        request=audio, model="nova-2", smart_format=True, filler_words=True)
    alt = response.results.channels[0].alternatives[0]
    return {
        "transcript": alt.transcript,
        "words": [{"word": w.word, "start": w.start, "end": w.end,
                   "punctuated": getattr(w, "punctuated_word", None) or w.word}
                  for w in alt.words],
        "duration": response.metadata.duration,
    }


# Deepgram only emits these when filler_words=True.
FILLER_SOUNDS = {"um", "uh", "uhm", "er", "ah", "hmm", "mhm", "mm"}


def find_fillers(words: list[dict]) -> list[str]:
    found = []
    for i, w in enumerate(words):
        word = w["word"].lower()
        nxt = words[i + 1]["word"].lower() if i + 1 < len(words) else ""
        if word in FILLER_SOUNDS:
            found.append(word)
        elif word == "you" and nxt == "know" and words[i + 1]["punctuated"].endswith(","):
            found.append("you know")
        # Only a comma-set-off "like" ("so, like, it was") is a filler;
        # "I like this" is not.
        elif word == "like" and (w["punctuated"].endswith(",")
                                 or (i > 0 and words[i - 1]["punctuated"].endswith(","))):
            found.append("like")
    return found


PAUSE_SECONDS = 2.0  # design doc: count pauses over 2 s


def compute_metrics(transcription: dict) -> dict:
    words = transcription["words"]
    filler_list = find_fillers(words)

    # From the first word to the last, so silence before/after doesn't count.
    speaking_time = words[-1]["end"] - words[0]["start"] if words else 0.0
    # Pace counts real words only; "um"/"uh" shouldn't make someone look faster.
    real_words = sum(1 for w in words if w["word"].lower() not in FILLER_SOUNDS)
    gaps = [b["start"] - a["end"] for a, b in zip(words, words[1:])]

    return {
        "wpm": round(real_words / speaking_time * 60) if speaking_time > 0 else 0,
        "fillers": len(filler_list),
        "filler_list": filler_list,
        "pauses": sum(1 for g in gaps if g > PAUSE_SECONDS),
        "longest_pause": round(max(gaps, default=0.0), 1),
        "speaking_time": round(speaking_time, 1),
    }


# Draft rubric from the design doc; Abhiram's final version replaces this.
RUBRIC = """\
- structure: clear hook, main points and conclusion (from the transcript)
- clarity: plain words, few fillers (transcript + filler count)
- delivery: steady pace (~130-160 wpm), purposeful pauses (wpm, pauses)
- persuasion: claims backed by reasons or examples (transcript)
- confidence: composite of the measured behaviours above, never a guess"""


class Scores(BaseModel):
    structure: int
    clarity: int
    delivery: int
    persuasion: int
    confidence: int


class Feedback(BaseModel):
    scores: Scores
    overall: int
    strengths: list[str]
    fixes: list[str]
    robot_line: str


def build_prompt(transcript: str, metrics: dict) -> str:
    return f"""You are a friendly, honest speech coach. Score this practice speech.

Rubric (score each category 1-10):
{RUBRIC}

Measured numbers (these are facts; explain them, never contradict or guess them):
{json.dumps(metrics, indent=2)}

Transcript:
\"\"\"{transcript}\"\"\"

Rules:
- overall is 0-100.
- 1-3 strengths, 2-3 fixes. Every fix quotes or points to a specific moment in the transcript.
- robot_line is spoken aloud by a robot: one short, friendly sentence, under 15 words.
- Return JSON only."""


_gemini: genai.Client | None = None


def _gemini_client() -> genai.Client:
    global _gemini
    if _gemini is None:
        _gemini = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    return _gemini


# Tried in order. Popular models return 503 "high demand" at busy times,
# so fall through to the next one instead of failing the demo.
GEMINI_MODELS = "gemini-3.5-flash-lite,gemini-3.8-flash,gemini-2.5-flash"


async def call_gemini(prompt: str) -> str:
    models = os.getenv("GEMINI_MODELS", GEMINI_MODELS).split(",")
    for model in models:
        try:
            response = await _gemini_client().aio.models.generate_content(
                model=model.strip(),
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json", response_schema=Feedback))
            return response.text
        except errors.APIError as e:
            if e.code not in (429, 500, 503) or model == models[-1]:
                raise


def parse_feedback_json(raw: str) -> dict:
    return Feedback.model_validate_json(raw).model_dump()


async def get_feedback(transcript: str, metrics: dict) -> dict:
    prompt = build_prompt(transcript, metrics)
    if os.getenv("AI_PROVIDER", "gemini") == "muse":
        raise NotImplementedError("Muse provider not wired yet; set AI_PROVIDER=gemini")
    return parse_feedback_json(await call_gemini(prompt))


class NoSpeechError(ValueError):
    pass


async def save_session(result: dict) -> None:
    pass


async def run_session(audio: bytes, vision: dict | None = None) -> dict:
    await broadcast({"type": "state", "value": "thinking"})
    try:
        transcription = await transcribe(audio)
        if not transcription["words"]:
            raise NoSpeechError("No speech detected in the recording")
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
        return result
    except Exception:
        await broadcast({"type": "lcd", "value": "Try again"})
        raise
    finally:
        # Whatever happens, never leave the robot stuck on "thinking".
        await broadcast({"type": "state", "value": "idle"})
