import asyncio
import json
import logging
import os
import re
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from deepgram import AsyncDeepgramClient
from google import genai
from google.genai import errors, types
from pydantic import BaseModel, ConfigDict, Field

from backend.events import broadcast, idle_after
from backend.routes.sessions import get_session_store

logger = logging.getLogger(__name__)

_deepgram: AsyncDeepgramClient | None = None


def _deepgram_client() -> AsyncDeepgramClient:
    global _deepgram
    if _deepgram is None:
        # Read at call time; the SDK's own default is captured at import.
        _deepgram = AsyncDeepgramClient(api_key=os.getenv("DEEPGRAM_API_KEY"))
    return _deepgram


# Too common to be worth boosting; boosting them makes Deepgram hear them where
# they weren't said.
COMMON_WORDS = {"the", "and", "for", "but", "with", "about", "from", "that", "this",
                "why", "how", "what", "when", "who", "your", "you", "our", "are", "was",
                "should", "can", "will", "not", "all", "everyone", "into", "its"}


def vocabulary(session: dict | None) -> list[str]:
    """Deepgram keywords ("word:boost") so names and jargon are spelled right.

    Deepgram can't be limited to a word list, only nudged toward words. The
    speaker's name is boosted most; DEEPGRAM_KEYWORDS in .env (comma-separated)
    adds fixed ones such as team names."""
    def words(text: str) -> list[str]:
        # 3+ letters: short words ("us", "at") are never the ones misheard.
        return [w for w in re.findall(r"[A-Za-z][\w'-]{2,}", text) if w.lower() not in COMMON_WORDS]

    boosted = [f"{w.strip()}:2" for w in os.getenv("DEEPGRAM_KEYWORDS", "").split(",") if w.strip()]
    if session:
        boosted += [f"{w}:2" for w in words(session["speaker"])]
        boosted += [f"{w}:1" for w in words(session["topic"])]
    return list(dict.fromkeys(boosted))[:50]  # dedupe; keep the request small


async def transcribe(audio: bytes, keywords: list[str] | None = None) -> dict:
    # nova-2, not nova-3: nova-3 silently drops um/uh even with filler_words=True.
    response = await _deepgram_client().listen.v1.media.transcribe_file(
        request=audio, model="nova-2", smart_format=True, filler_words=True,
        keywords=keywords or None)
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

    hedge_list = find_hedges(transcription["transcript"])
    return {
        "wpm": round(real_words / speaking_time * 60) if speaking_time > 0 else 0,
        "fillers": len(filler_list),
        "filler_list": filler_list,
        "hedge_count": len(hedge_list),
        "hedge_list": hedge_list,
        "pauses": sum(1 for g in gaps if g > PAUSE_SECONDS),
        "longest_pause": round(max(gaps, default=0.0), 1),
        "speaking_time": round(speaking_time, 1),
    }


# RUBRIC.md: hedges such as "I think maybe" or "sort of".
HEDGES = ["i think", "i guess", "i feel like", "i suppose", "maybe", "perhaps", "probably",
          "possibly", "sort of", "kind of"]
_HEDGE_RE = re.compile(r"\b(" + "|".join(re.escape(h) for h in HEDGES) + r")\b")


def find_hedges(transcript: str) -> list[str]:
    return _HEDGE_RE.findall(re.sub(r"[^\w\s']", " ", transcript.lower()))


# ---- scoring (RUBRIC.md): code scores what it measured, Gemini what it judges ----

CRITERION_CATEGORY = {
    "filler_words": "clarity", "confident_language": "clarity", "relevance": "clarity",
    "pace": "delivery", "pauses": "delivery",
    "structure": "structure", "timing": "structure",
    "eye_contact": "body_language", "posture": "body_language",
    "evidence": "persuasion",
}
JUDGED = ("relevance", "structure", "evidence")  # vocal_variety and script_coverage: not built

# Overall-score weights per mode, in percent (RUBRIC.md).
WEIGHTS = {
    "presentation": {"structure": 25, "clarity": 20, "delivery": 25, "body_language": 15, "persuasion": 15},
    "debate":       {"structure": 20, "clarity": 20, "delivery": 15, "body_language": 15, "persuasion": 30},
    "interview":    {"structure": 30, "clarity": 25, "delivery": 20, "body_language": 15, "persuasion": 10},
}


def _band(value: float, limits: tuple, scores=(10, 8, 6, 4, 2), floor: int = 1) -> int:
    """The score of the first column the value fits (value <= limit), else floor."""
    return next((s for limit, s in zip(limits, scores) if value <= limit), floor)


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def _clock(seconds: float) -> str:
    return f"{int(seconds // 60)}:{int(seconds % 60):02d}"


def measured_criteria(m: dict) -> list[dict]:
    """Score the measured criteria with RUBRIC.md's tables. A criterion whose input is
    missing (no camera, no target length) is left out, as the rubric says."""
    minutes = max(m["speaking_time"], 30) / 60  # under 30 s, per-minute rates would explode
    out = []

    def add(cid: str, score: int, detail: str):
        out.append({"id": cid, "category": CRITERION_CATEGORY[cid], "score": score, "detail": detail})

    fpm, hpm = m["fillers"] / minutes, m["hedge_count"] / minutes
    add("filler_words", _band(fpm, (1, 2, 4, 6, 8)), f"{_plural(m['fillers'], 'filler')} ({fpm:.1f} per minute)")
    add("confident_language", _band(hpm, (1, 2, 4, 6, 8)), f"{_plural(m['hedge_count'], 'hedge')} ({hpm:.1f} per minute)")

    wpm = m["wpm"]
    pace = next((s for lo, hi, s in [(130, 160, 10), (120, 175, 8), (110, 190, 6), (100, 205, 4), (90, 220, 2)]
                 if lo <= wpm <= hi), 1)
    add("pace", pace, f"{wpm} words per minute")
    add("pauses", _band(m["pauses"], (0, 1, 2, 3, 4)),
        f"{_plural(m['pauses'], 'pause')} over 2 s, longest {m['longest_pause']} s")

    if m.get("target_length_sec"):
        target = m["target_length_sec"]
        gap = abs(m["speaking_time"] - target) / target
        add("timing", _band(gap, (.10, .20, .35, .50), (10, 8, 6, 4), floor=2),
            f"{_clock(m['speaking_time'])} of a {_clock(target)} target")
    if isinstance(m.get("eye_contact_pct"), (int, float)):
        pct = m["eye_contact_pct"]
        add("eye_contact", _band(-pct, (-70, -60, -50, -35), (10, 8, 6, 4), floor=2),
            f"{round(pct)}% of the time facing the camera")
    if "posture_alerts" in m:
        alerts = m["posture_alerts"] + m.get("hands_alerts", 0)  # hands feed posture (RUBRIC.md)
        add("posture", _band(alerts, (0, 1, 2, 3), (10, 8, 6, 4), floor=2), _plural(alerts, "posture alert"))
    return out


class VisionStats(BaseModel):
    """What the browser tallies from the vision module's alerts during a speech."""
    model_config = ConfigDict(extra="forbid")  # a typo'd key should fail loudly

    posture_alerts: int = Field(0, ge=0)
    hands_alerts: int = Field(0, ge=0)
    eye_contact_alerts: int = Field(0, ge=0)
    eye_contact_pct: float | None = Field(None, ge=0, le=100)  # None = not measured
    # Which behaviour each posture/hands alert was. Optional: older clients don't send them.
    slouch_alerts: int | None = Field(None, ge=0)
    sway_alerts: int | None = Field(None, ge=0)
    pocket_alerts: int | None = Field(None, ge=0)
    fidget_alerts: int | None = Field(None, ge=0)


class JudgedScore(BaseModel):
    id: str      # relevance | structure | evidence
    score: int   # 0-10
    detail: str  # one sentence quoting or pointing to the transcript
    tip: str


class CriterionTip(BaseModel):
    id: str
    tip: str


class CoachReply(BaseModel):
    """What Gemini returns; scores and the overall come from code (RUBRIC.md)."""
    judged: list[JudgedScore]
    tips: list[CriterionTip]
    strengths: list[str]
    fixes: list[str]
    robot_line: str


# RUBRIC.md anchors for the judged criteria (10 / 7 / 4 / 1).
ANCHORS = """\
- relevance: 10 every section serves the stated topic; 7 mostly on topic with one tangent;
  4 several tangents, topic unclear at times; 1 mostly unrelated to the topic.
- structure: 10 hook, clear main points and a conclusion that lands; 7 all three parts
  present, one weak; 4 a part is missing or the points blur; 1 no discernible order.
- evidence: 10 every claim has a reason, example or number; 7 most claims supported, one
  only asserted; 4 mostly assertions with a few examples; 1 no support offered."""

MODE_RULES = {
    "debate": "Debate mode: judge evidence by how well the claims answer the opposing side.",
    "interview": "Interview mode: judge structure against STAR (Situation, Task, Action, Result) "
                 "and name the missing parts in its detail.",
}


def build_prompt(transcript: str, measured: list[dict], session: dict | None = None) -> str:
    context = f"Mode: {session['mode']}. Topic: {session['topic']}.\n" if session else ""
    scored = "\n".join(f"- {c['id']}: {c['score']}/10 ({c['detail']})" for c in measured)
    return f"""You are a friendly, honest speech coach. {context}
These criteria were measured and scored by code. They are facts: explain them, never
re-score or contradict them:
{scored}

Score these three yourself, 0-10, using the anchors (scores between anchors are fine):
{ANCHORS}
{MODE_RULES.get((session or {}).get('mode'), '')}

Transcript:
\"\"\"{transcript}\"\"\"

Return JSON only:
- judged: relevance, structure and evidence, each with a score, a detail sentence that
  quotes or points to a specific moment in the transcript, and one concrete tip.
- tips: one concrete tip for each measured criterion above, by id.
- strengths: exactly one, specific. fixes: at most three, from the lowest-scoring criterion
  up, each quoting or pointing to a moment in the transcript.
- robot_line: spoken aloud by a robot; one friendly sentence under 20 words.
- Never say you detect confidence or emotion."""


def assemble_feedback(measured: list[dict], reply: CoachReply, mode: str | None) -> dict:
    """Criteria list, category scores, confidence composite and the weighted overall,
    all computed in code from RUBRIC.md."""
    tips = {t.id: t.tip for t in reply.tips}
    criteria = [{**c, "tip": tips.get(c["id"], "")} for c in measured]
    for j in reply.judged:
        if j.id in JUDGED and all(c["id"] != j.id for c in criteria):
            criteria.append({"id": j.id, "category": CRITERION_CATEGORY[j.id],
                             "score": max(0, min(10, j.score)), "detail": j.detail, "tip": j.tip})

    exact: dict[str, float] = {}  # unrounded category averages, for the overall
    for category in WEIGHTS["presentation"]:
        values = [c["score"] for c in criteria if c["category"] == category]
        if values:
            exact[category] = sum(values) / len(values)

    # Confidence: composite of measured behaviour, never "AI detects confidence".
    confident_language = next((c["score"] for c in criteria if c["id"] == "confident_language"), None)
    parts = [v for v in (exact.get("delivery"), exact.get("body_language"), confident_language) if v is not None]

    scores = {k: round(v) for k, v in exact.items()}
    for required in ("structure", "clarity", "delivery", "persuasion"):
        if required not in scores:  # only if Gemini skipped a judged criterion
            logger.warning("No score for %s; showing 5", required)
            scores[required] = 5
    scores["confidence"] = round(sum(parts) / len(parts)) if parts else scores["delivery"]

    weights = WEIGHTS.get(mode or "", WEIGHTS["presentation"])
    total = sum(weights[c] for c in exact)
    overall = round(10 * sum(weights[c] * v for c, v in exact.items()) / total) if total else 50
    return {"scores": scores, "overall": overall, "strengths": reply.strengths,
            "fixes": reply.fixes[:3], "robot_line": reply.robot_line, "criteria": criteria}


_gemini: genai.Client | None = None


def _gemini_client() -> genai.Client:
    global _gemini
    if _gemini is None:
        _gemini = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    return _gemini


# Tried in order. Popular models return 503 "high demand" at busy times,
# so fall through to the next one instead of failing the demo.
GEMINI_MODELS = "gemini-3.5-flash-lite,gemini-3.8-flash,gemini-2.5-flash"


async def call_gemini(prompt: str, schema: type[BaseModel]) -> str:
    models = os.getenv("GEMINI_MODELS", GEMINI_MODELS).split(",")
    for model in models:
        try:
            response = await _gemini_client().aio.models.generate_content(
                model=model.strip(),
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json", response_schema=schema))
            return response.text
        except errors.APIError as e:
            if e.code not in (429, 500, 503) or model == models[-1]:
                raise


async def get_feedback(transcript: str, metrics: dict, session: dict | None = None) -> dict:
    measured = measured_criteria(metrics)
    prompt = build_prompt(transcript, measured, session)
    if os.getenv("AI_PROVIDER", "gemini") == "muse":
        raise NotImplementedError("Muse provider not wired yet; set AI_PROVIDER=gemini")
    reply = CoachReply.model_validate_json(await call_gemini(prompt, CoachReply))
    return assemble_feedback(measured, reply, (session or {}).get("mode"))


# ---- audience question (after the speech; one web search per question) ----

class SearchPlan(BaseModel):
    claim: str
    search_query: str


class Question(BaseModel):
    question: str
    source_index: int | None  # 1-based number of the search result it rests on


# Social posts mostly repeat claims (often myths); they make poor sources.
SKIP_SOURCES = re.compile(r"(^|\.)(linkedin|facebook|instagram|tiktok|twitter|x|reddit|quora|"
                          r"youtube|pinterest)\.com$")


async def web_search(query: str) -> list[dict]:
    """One Google search through SerpApi: up to 3 results with title, url, snippet.

    Returns [] without SERPAPI_API_KEY or if the search fails, so the question
    is still asked, just without a source."""
    key = os.getenv("SERPAPI_API_KEY")
    if not key:
        return []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get("https://serpapi.com/search.json", params={
                "engine": "google", "q": query, "api_key": key, "num": 10, "hl": "en"})
            response.raise_for_status()
            data = response.json()
    except Exception as error:
        # Never log the exception text: httpx puts the request URL, key included, in it.
        reason = type(error).__name__
        if isinstance(error, httpx.HTTPStatusError):
            try:
                reason = f"HTTP {error.response.status_code}: {error.response.json().get('error', '')}"
            except Exception:
                reason = f"HTTP {error.response.status_code}"
        logger.warning("Web search failed, asking without a source: %s", reason)
        return []
    hits = [data.get("answer_box") or {}, *data.get("organic_results", [])]
    return [{"title": h.get("title", ""), "url": h["link"],
             "snippet": h.get("snippet") or h.get("answer") or ""}
            for h in hits if h.get("link") and (h.get("snippet") or h.get("answer"))
            and not SKIP_SOURCES.search(urlsplit(h["link"]).hostname or "")][:3]


def _listed(sources: list[dict]) -> str:
    return "\n".join(f"{i}. {s['title']}: {s['snippet']} ({s['url']})"
                     for i, s in enumerate(sources, 1)) or "No search results."


def _source(sources: list[dict], n: int | None) -> dict | None:
    return sources[n - 1] if n and 1 <= n <= len(sources) else None


async def ask_question(session: dict, results: dict) -> dict:
    """What the robot says when called on, by mode: a question (presentation), a
    counter-argument (debate) or an interview question about the speaker (interview)."""
    if session.get("mode") == "debate":
        return await _debate_counter(session, results)
    if session.get("mode") == "interview":
        return await _interview_question(session, results)
    return await _audience_question(session, results)


class DebatePlan(BaseModel):
    position: str
    search_queries: list[str]


class Counter(BaseModel):
    counter: str
    source_index: int | None


async def _debate_counter(session: dict, results: dict) -> dict:
    """The opponent's counter-argument: two searches for evidence against the speaker."""
    plan = DebatePlan.model_validate_json(await call_gemini(f"""You are a sharp, fair debate opponent.
Motion: {session['topic']}

The speaker's argument:
\"\"\"{results['transcript']}\"\"\"

State the speaker's main position in one sentence. Then write TWO different short Google
search queries that would find the strongest evidence AGAINST that position (research,
data, reputable reporting; words like "study" or "evidence" help). Return JSON only.""",
        DebatePlan))

    queries = [q for q in plan.search_queries if q.strip()][:2]
    found = await asyncio.gather(*(web_search(q) for q in queries))
    sources = list({s["url"]: s for hits in found for s in hits}.values())[:4]  # dedupe
    countered = Counter.model_validate_json(await call_gemini(f"""You are the opposing debater replying to this speech.
Their position: "{plan.position}"

Search results:
{_listed(sources)}

Give ONE counter-argument, under 45 words; it is spoken aloud.
- Attack the strongest point of their position, not a side detail.
- Build it on a trustworthy result if one helps, and set source_index to its number;
  otherwise set source_index to null and argue from reasoning alone.
- End by challenging them to respond. Firm but friendly.
- Never state facts that are not in the results. Return JSON only.""", Counter))

    return {"question": countered.counter, "claim": plan.position,
            "search_query": " | ".join(queries), "source": _source(sources, countered.source_index),
            "kind": "counter"}


class InterviewQuestion(BaseModel):
    question: str
    focus: str  # what the question probes, e.g. "handling a failed project"


async def _interview_question(session: dict, results: dict) -> dict:
    """An interviewer's follow-up about the speaker themselves; nothing to search."""
    asked = InterviewQuestion.model_validate_json(await call_gemini(f"""You are interviewing the speaker for: {session['topic']}

What they just said:
\"\"\"{results['transcript']}\"\"\"

Ask ONE follow-up interview question about THEM: their own experience, decisions, skills
or motivation, the way a good hiring manager would. A behavioural question ("Tell me
about a time...") that digs into something they mentioned is ideal. Under 30 words; it is
spoken aloud. focus names what the question probes, in a few words. Return JSON only.""",
        InterviewQuestion))
    return {"question": asked.question, "claim": asked.focus, "search_query": "",
            "source": None, "kind": "interview"}


async def _audience_question(session: dict, results: dict) -> dict:
    """Presentation: pick a claim, search it once, ask about it."""
    transcript = results["transcript"]
    plan = SearchPlan.model_validate_json(await call_gemini(f"""You are an engaged audience member at a practice speech.
Topic: {session['topic']}

Transcript:
\"\"\"{transcript}\"\"\"

Pick the ONE claim most worth checking: a fact, number or bold generalisation. If there
is none, pick the speech's main point. Write a short Google search query that would find
research, survey data or reputable reporting on it (words like "study" or "survey" help).
Return JSON only.""", SearchPlan))

    sources = await web_search(plan.search_query)
    asked = Question.model_validate_json(await call_gemini(f"""You raised your hand after this practice speech and were called on.
The claim you are asking about: "{plan.claim}"

Search results:
{_listed(sources)}

Ask ONE short, friendly but sharp question, under 30 words; it is spoken aloud.
- It must make the speaker defend or deepen the claim: ask for their evidence, raise a
  counterpoint, or ask where it stops being true. Never just agree, and never ask
  "did you know".
- Trust research, surveys, universities, governments and established news over pages
  that only repeat the claim.
- If a trustworthy result contradicts or complicates the claim, build the question on it
  and set source_index to its number. Otherwise set source_index to null and ask the
  speaker where the claim comes from.
- If the claim is about the speaker's own experience, ask a curious follow-up instead.
- Never state facts that are not in the results. Return JSON only.""",
        Question))

    return {"question": asked.question, "claim": plan.claim, "search_query": plan.search_query,
            "source": _source(sources, asked.source_index), "kind": "question"}


class NoSpeechError(ValueError):
    pass


# ---- the speaker's answer to that question: recorded once, rated once ----

class AnswerRating(BaseModel):
    score: int        # 0-10
    answered: bool    # False if the answer dodged the question
    did_well: str
    improve: str
    robot_line: str


async def rate_answer(audio: bytes, question: str, claim: str, session: dict | None = None) -> dict:
    await broadcast({"type": "state", "value": "thinking"})
    handed_off = False
    try:
        transcription = await transcribe(audio, vocabulary(session))
        if not transcription["words"]:
            raise NoSpeechError("No speech detected in the answer")
        m = compute_metrics(transcription)
        metrics = {k: m[k] for k in ("wpm", "fillers", "filler_list", "speaking_time")}

        mode = (session or {}).get("mode")
        asked, criteria = {
            "debate": (f'As their debate opponent you countered:\n"{question}"\n(against their position: "{claim}")',
                       "did the rebuttal take on the counter-argument directly; did it give evidence or a "
                       "concrete reason; was the logic sound; was it clear and composed (few fillers)"),
            "interview": (f'As their interviewer you asked:\n"{question}"\n(probing: "{claim}")',
                          "did it answer the question; did it give a specific example with situation, task, "
                          "action and result (STAR); was it relevant to the role; was it concise and composed "
                          "(few fillers)"),
        }.get(mode, (f'After a practice speech you asked the speaker:\n"{question}"\n(about their claim: "{claim}")',
                     "did it directly answer the question; did it give evidence or a concrete reason; was it "
                     "clear and concise; was it composed (few fillers)"))

        rating = AnswerRating.model_validate_json(await call_gemini(f"""You are a friendly, honest speech coach. {asked}

Their spoken answer:
\"\"\"{transcription['transcript']}\"\"\"

Measured (facts; explain them, never contradict them):
{json.dumps(metrics)}

Rate the answer 0-10 on: {criteria}.
- answered is false if they dodged the question or talked about something else.
- did_well and improve: one specific sentence each, quoting or pointing to the answer.
- robot_line is spoken aloud by a robot: one short, friendly sentence, under 15 words.
Return JSON only.""", AnswerRating)).model_dump()

        await broadcast({"type": "lcd", "value": f"Answer: {rating['score']}/10"})
        await broadcast({"type": "state", "value": "speaking"})
        idle_after(speaking_seconds(rating["robot_line"]))  # green while the browser says it
        handed_off = True
        return {"transcript": transcription["transcript"], "metrics": metrics, "rating": rating}
    except Exception:
        await broadcast({"type": "lcd", "value": "Try again"})
        raise
    finally:
        if not handed_off:  # errors or a cancelled request: never leave the robot thinking
            await broadcast({"type": "state", "value": "idle"})


def speaking_seconds(line: str) -> float:
    """Roughly how long the browser's voice takes to say `line` (~2.5 words/s)."""
    return min(8.0, 1.5 + 0.4 * len(line.split()))


async def save_session(result: dict) -> bool:
    """False instead of raising: a database outage must not cost the speaker their feedback."""
    if result["session_id"] is None:
        return False
    try:
        await asyncio.to_thread(get_session_store().save_results,
                                UUID(result["session_id"]), result)
        return True
    except Exception:
        logger.exception("Saving results failed")
        return False


async def run_session(audio: bytes, vision: VisionStats | None = None,
                      session: dict | None = None, target_length_sec: int | None = None) -> dict:
    await broadcast({"type": "state", "value": "thinking"})
    handed_off = False  # True once idle_after() owns going back to idle
    try:
        transcription = await transcribe(audio, vocabulary(session))
        if not transcription["words"]:
            raise NoSpeechError("No speech detected in the recording")
        metrics = compute_metrics(transcription)
        if vision:
            metrics.update(vision.model_dump(exclude_none=True))
        if target_length_sec:
            metrics["target_length_sec"] = target_length_sec  # enables the timing criterion

        feedback = await get_feedback(transcription["transcript"], metrics, session)

        await broadcast({"type": "metrics", "value": metrics})
        await broadcast({"type": "feedback", "value": feedback})
        await broadcast({"type": "lcd", "value": f"Score: {feedback['overall']}/100"})
        await broadcast({"type": "state", "value": "speaking"})

        result = {"session_id": session["session_id"] if session else None,
                  "transcript": transcription["transcript"],
                  "metrics": metrics, "feedback": feedback}
        result["saved"] = await save_session(result)
        if session:  # it has a question; POST /sessions/{id}/question lowers the hand
            await broadcast({"type": "hand", "value": "raise"})
        # Green while the Results screen reads robot_line aloud, then idle.
        idle_after(speaking_seconds(feedback["robot_line"]))
        handed_off = True
        return result
    except Exception:
        await broadcast({"type": "lcd", "value": "Try again"})
        raise
    finally:
        # Whatever happens (errors, a cancelled request), never leave the robot thinking.
        if not handed_off:
            await broadcast({"type": "state", "value": "idle"})
