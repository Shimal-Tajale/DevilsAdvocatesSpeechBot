# Speech Coach Rubric and Scoring System

Oct 24, 2026 · @Abhiram Jetty

## Overview

Every speech is scored by 13 criteria: code measures what can be counted, and Gemini judges only what needs reading. Scores run 0 to 10 per criterion and 0 to 100 overall.

The 13 criteria sit in five scored categories (structure, clarity, delivery, body language, persuasion) plus a confidence composite.

- **Backend:** implements the threshold tables in Scoring rules and the roll-ups in Categories and overall score.
- **Gemini prompt:** receives the measured numbers plus the anchors in Judged criteria, and returns the JSON in Backend output.
- **Frontend:** renders the scorecard from that JSON and shows live alerts from the alert events.

Why the split: pace, fillers and eye contact are counted by code, so anyone can check those scores. Asking Gemini to guess them from audio gives numbers nobody can verify, which weakens the pitch that scores come from measured behavior.

## Scoring scale

Each criterion scores 0 to 10 (whole numbers). Categories average their criteria, and the overall score is 0 to 100.

| Score | Label | How the scorecard uses it |
| --- | --- | --- |
| 8 to 10 | Nailed it | Named first as a strength |
| 5 to 7 | Getting there | Solid base with one clear fix |
| 0 to 4 | Focus here | The top priority for the next practice |

The scorecard shows these labels beside each bar instead of red numbers. It opens with the highest-scoring criterion as a strength, then lists the two lowest as fixes.

## Criteria

Eight criteria are measured by code and five are judged by Gemini. Criterion ids are snake\_case and are used as-is in the JSON.

| Criterion id | Category | What it measures | Source | Backend field |
| --- | --- | --- | --- | --- |
| `filler_words` | clarity | um, uh, like, you know, per minute | Measured (Deepgram transcript) | `filler_count` |
| `confident_language` | clarity | Hedges such as "I think maybe" or "sort of", per minute | Measured (hedge list on the transcript) | `hedge_count` (new) |
| `relevance` | clarity | Staying on the stated topic | Judged (Gemini) | `criteria` |
| `pace` | delivery | Words per minute | Measured | `wpm` |
| `pauses` | delivery | Pauses over 2 s and the longest pause | Measured | `pause_count`, `longest_pause_sec` (new) |
| `volume` | delivery | Share of speaking time at an audible level | Measured (browser Web Audio) | `audible_pct` (new) |
| `vocal_variety` | delivery | Pitch variation, monotone versus expressive | Judged (Gemini, audio); optional | `criteria` |
| `structure` | structure | Clear opening, main points and conclusion | Judged (Gemini) | `criteria` |
| `timing` | structure | Actual length versus target length | Measured | `duration_sec`, `target_length_sec` (new) |
| `script_coverage` | structure | Key points of an uploaded script that were covered | Judged (Gemini); only with a script | `criteria` |
| `eye_contact` | body\_language | Share of time facing the camera | Measured (MediaPipe) | `eye_contact_pct` |
| `posture` | body\_language | Sustained slouching, hidden hands, swaying | Measured (MediaPipe) | `posture_alerts` |
| `evidence` | persuasion | Claims backed by reasons or examples | Judged (Gemini) | `criteria` |

Fields marked new are not in the database table of the original design doc, so the backend needs to add them. `vocal_variety` can be dropped from the first version without breaking anything else.

## Scoring rules for measured criteria

Each measured criterion takes the first column its value fits. A value worse than the last column scores 1.

| Criterion | Input | 10 | 8 | 6 | 4 | 2 |
| --- | --- | --- | --- | --- | --- | --- |
| `filler_words` | fillers per minute | 1 or fewer | up to 2 | up to 4 | up to 6 | up to 8 |
| `confident_language` | hedges per minute | 1 or fewer | up to 2 | up to 4 | up to 6 | up to 8 |
| `pace` | words per minute | 130 to 160 | 120 to 129 or 161 to 175 | 110 to 119 or 176 to 190 | 100 to 109 or 191 to 205 | 90 to 99 or 206 to 220 |
| `pauses` | pauses over 2 s | 0 | 1 | 2 | 3 | 4 |
| `volume` | audible share of speaking time | 90% or more | 80% or more | 70% or more | 50% or more | under 50% |
| `timing` | gap from target length | within 10% | within 20% | within 35% | within 50% | over 50% |
| `eye_contact` | share of time facing the camera | 70% or more | 60% or more | 50% or more | 35% or more | under 35% |
| `posture` | sustained posture alerts | 0 | 1 | 2 | 3 | 4 or more |

If an input is missing (no camera, no target length), skip that criterion and leave it out of its category average. These thresholds are a first draft: run three real recordings through them and adjust before the demo.

## Anchors for judged criteria

Gemini scores these five from the transcript (and audio for `vocal_variety`) against the descriptions below. Scores between two anchors are allowed.

| Criterion | 10 | 7 | 4 | 1 |
| --- | --- | --- | --- | --- |
| `relevance` | Every section serves the stated topic | Mostly on topic with one tangent | Several tangents, topic unclear at times | Mostly unrelated to the topic |
| `vocal_variety` | Pitch and energy shift to stress key points | Some variation with flat stretches | Mostly flat, occasional change | Monotone throughout |
| `structure` | Hook, clear main points and a conclusion that lands | All three parts present, one weak | A part is missing or the points blur | No discernible order |
| `script_coverage` | Every key point covered in the planned order | Most points covered, one missed or rushed | About half the points covered | Few points covered |
| `evidence` | Every claim has a reason, example or number | Most claims supported, one only asserted | Mostly assertions with a few examples | No support offered |

Every judged score comes with one sentence that quotes or points to a specific moment in the transcript.

## Categories and overall score

A category score is the average of its available criteria. The overall score is a weighted average of the category scores, scaled to 100, with weights that depend on the mode.

| Category | Criteria it averages |
| --- | --- |
| `structure` | `structure`, `timing`, `script_coverage` |
| `clarity` | `filler_words`, `confident_language`, `relevance` |
| `delivery` | `pace`, `pauses`, `volume`, `vocal_variety` |
| `body_language` | `eye_contact`, `posture` |
| `persuasion` | `evidence` |
| `confidence` | Composite: average of `delivery`, `body_language` and `confident_language`. Shown on the scorecard but left out of the overall score so nothing is counted twice. |

Weights by mode, in percent. Mode ids are `presentation`, `debate` and `interview`.

| Category | presentation | debate | interview |
| --- | --- | --- | --- |
| `structure` | 25 | 20 | 30 |
| `clarity` | 20 | 20 | 25 |
| `delivery` | 25 | 15 | 20 |
| `body_language` | 15 | 15 | 15 |
| `persuasion` | 15 | 30 | 10 |

```latex
overall = \mathrm{round}\left(10 \times \frac{\sum w_c \, s_c}{\sum w_c}\right)
```

The sums run only over categories that have a score, so a missing camera drops `body_language` and the other weights rescale. Example in presentation mode: structure 7, clarity 8, delivery 6, body language 9, persuasion 6 gives 10 × (25×7 + 20×8 + 25×6 + 15×9 + 15×6) ÷ 100 = 71.

The composite is labeled "confidence score" and always built from measured behaviors, never described as the AI detecting confidence.

## Live alerts

Each alert type from the event contract feeds one criterion, so the live view and the final score agree.

| Alert value | Feeds criterion | Fires when | Live in MVP |
| --- | --- | --- | --- |
| `posture` | `posture` | Slouching or swaying lasts about 2 s | Yes (browser vision) |
| `hands` | `posture` | Hands hidden or at the hips for about 2 s | Yes (browser vision) |
| `eye_contact` | `eye_contact` | Facing away from the camera for about 2 s | Yes (browser vision) |
| `too_quiet` | `volume` | Volume stays below the audible level for about 2 s | Yes (Web Audio) |
| `too_fast` | `pace` | Rolling pace above 175 words per minute (proposed) | No, needs streaming speech-to-text |
| `filler` | `filler_words` | A filler word is detected | No, needs streaming speech-to-text |

Rules from the design doc:

- An alert fires only when the behavior lasts about 2 s.
- At most one alert of each kind every 12 s. The frontend applies the same limit to toasts.
- The robot never speaks during a speech. It uses lights, movement, the LCD and a beep.

## Backend output

The feedback JSON keeps every existing key and adds `body_language` to `scores` plus an optional `criteria` array. Nothing existing changes, so the robot and the LCD keep working.

```json
{
  "scores": {"structure": 7, "clarity": 6, "delivery": 6, "body_language": 8, "persuasion": 6, "confidence": 7},
  "overall": 66,
  "strengths": ["Strong opening hook"],
  "fixes": ["Cut 'um' before key points", "Pause after your main claim"],
  "robot_line": "Great hook! Next time, slow down in the middle.",
  "criteria": [
    {"id": "filler_words", "category": "clarity", "score": 4, "detail": "14 fillers (5.2 per minute)", "tip": "Pause instead of saying 'um' before a key point."},
    {"id": "eye_contact", "category": "body_language", "score": 8, "detail": "63% of the time facing the camera", "tip": "Look at the camera when you state your main claim."}
  ]
}
```

- `scores` values are whole numbers from 0 to 10. `overall` is 0 to 100, computed by the backend from the weights above, not by Gemini.
- `criteria` holds one entry per scored criterion, using the ids in the Criteria table. The frontend shows the detailed section only when the array is present.
- `detail` states the measured number. `tip` is one concrete action.
- The new measured fields (`hedge_count`, `audible_pct`, `longest_pause_sec`, `duration_sec`, `target_length_sec`) go in `metrics` next to the existing ones.

## Prompt rules for Gemini

The prompt carries the measured numbers and these rules, and the backend validates the reply before it reaches the frontend.

- Give Gemini the measured numbers and the scores code already computed. It explains them and never re-estimates them.
- Gemini scores only the five judged criteria, using the anchors above. The backend ignores any score it returns for a measured criterion.
- Every fix quotes or points to a specific moment in the transcript.
- Open with one strength, then give at most three fixes, ordered from the lowest-scoring criterion up.
- Return JSON only, matching the schema in Backend output, with no Markdown fences.
- Keep `robot_line` under 20 words and friendly, since it is spoken aloud.
- Debate mode: judge `evidence` by how well claims answer the opposing side. Interview mode: judge `structure` against the STAR method (Situation, Task, Action, Result) and name the missing parts.
- Never say the AI detects confidence or emotion. Confidence is the composite of measured behaviors.

## Open items for the backend team

- [ ] Settle one set of metric key names. The event contract says `fillers` and `pauses`, the database says `filler_count` and `pause_count`.
- [ ] Add `target_length_sec` and an optional `script` to `POST /sessions`, since `timing` and `script_coverage` need them.
- [ ] Add the new metrics: `hedge_count`, `audible_pct`, `longest_pause_sec`, `duration_sec`, `target_length_sec`. The browser measures `audible_pct` and sends it with the vision stats.
- [ ] Return `body_language` in `scores` and the `criteria` array, and compute `overall` in code from the weights.
- [ ] Confirm the mode ids `presentation`, `debate` and `interview`. The frontend sends exactly these strings.
- [ ] Decide what Gemini receives: the transcript alone covers four judged criteria, and audio is needed only if `vocal_variety` stays.
