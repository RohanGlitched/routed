# Outside tests, round 2: results

**Sources.**
- Protocol: `data/outside2/PROTOCOL.md`, committed in bcaa653 before any Qloo or model call was made.
- Script: `scripts/outside2.ts`.
- Every artist, city, list and rank: `results.json`.
- The model's answers: `model-runs.json`.
- The draws and every skipped page: `venues-truth.json`, `support-truth.json` and `post-cutoff.json`.

Raw Qloo responses are not published (Qloo's developer terms). This page carries only derived room and artist
names, ranks and hit counts.

**Spend.** 323 of 400 Qloo requests:

| Test | Qloo requests |
|---|---|
| Venues | 233 |
| Support | 63 |
| Post-cutoff sample | 14 |
| Post-cutoff run | 13 |

The model made 70 calls (8,810 tokens in, 20,709 out), about **$0.07** at list price. No cap was reached, and
every scheduled artist was scored.

## Test 1: venues

The test covers 34 artists and 102 real-tour cities, 3 cities per artist drawn by a hash order. In each city, the
question is whether the room the artist really played is in a method's top 3. Each artist's score is the share of
their cities with a hit, and the contrasts are paired per artist.

| Contrast | n | A | B | A − B, pts [95% CI] | wins–losses–ties | sign test p |
|---|---|---|---|---|---|---|
| **Qloo (artist signal) vs Qloo popularity only** | 34 | 28.4% | 34.3% | −5.9 [−11.8, −1.0] | 1–6–27 | 0.125 |
| **Qloo vs the model alone** | 34 | 28.4% | 73.5% | −45.1 [−57.8, −33.3] | 1–26–7 | < 0.001 |
| The model alone vs Qloo popularity only | 34 | 73.5% | 34.3% | +39.2 [+26.5, +52.0] | 24–3–7 | < 0.001 |
| Qloo vs the biggest fitting Wikidata room | 34 | 28.4% | 37.3% | −8.8 [−23.5, +5.9] | 9–12–13 | 0.664 |
| The model alone vs the biggest fitting Wikidata room | 34 | 73.5% | 37.3% | +36.3 [+24.5, +49.0] | 21–0–13 | < 0.001 |
| Qloo in Routed's measuring order vs Qloo popularity only | 34 | 26.5% | 34.3% | −7.8 [−14.7, −2.0] | 0–6–28 | 0.031 |
| Qloo vs the model alone, hit@1 | 34 | 15.7% | 53.9% | −38.2 [−48.0, −27.5] | 1–25–8 | < 0.001 |
| Qloo vs the model alone, MRR@5 | 34 | 21.9% | 63.6% | −41.8 [−50.6, −32.5] | 1–29–4 | < 0.001 |
| Qloo vs Qloo popularity only, hit@1 | 34 | 15.7% | 24.5% | −8.8 [−15.7, −2.9] | 0–7–27 | 0.016 |

The first two rows (in bold) are the primary contrasts; the rest are secondary.

| Method | Cities | Real venue at #1 | In top 3 | Listed at all | Median rank when listed |
|---|---|---|---|---|---|
| Qloo, the artist's room ranking (Routed's lookUpRooms) | 102 | 16 | 29 | 39 | 2 |
| Qloo's rooms in Routed's measuring order | 102 | 18 | 27 | 39 | 2 |
| Qloo places by popularity (no artist signal) | 102 | 25 | 35 | 49 | 1 |
| Biggest fitting room on Wikidata | 102 | 27 | 38 | 42 | 1 |
| Nemotron 3 Ultra alone | 102 | 55 | 75 | 78 | 1 |

**Why Qloo loses here.**
- In 9 of the 102 cities, Qloo's room query for the artist returned no room after Routed's filters. For example,
  Depeche Mode's Barcelona and Łódź came back empty.
- In 31 cities it returned fewer than 3 rooms.
- Arena-sized rooms are often missing from the artist-signal answer altogether. For example:
  - Dua Lipa's list for New York had Barclays Center but not Madison Square Garden.
  - Her Boston list had no TD Garden.
  - Doja Cat's Las Vegas list had no T-Mobile Arena.
- Qloo's affinity ranking also favours rooms where the artist's fans over-index (small, niche places) over the
  room a tour actually books. The same request with no artist signal, sorted by popularity, finds more of the
  real venues.
- On the 7 tours with crowds under 5,000, the gap narrows but stays:

  | Method | Hit@3, crowds under 5,000 |
  |---|---|
  | Qloo | 19% |
  | Popularity only | 38% |
  | The model | 43% |

## Test 2: support acts

The test covers 22 artists whose Wikipedia tour tables name the openers. The question is whether a real opener is
among a method's top 5.

| Contrast | n | Qloo | Model | Qloo − model, pts [95% CI] | wins–losses–ties | sign test p |
|---|---|---|---|---|---|---|
| **Hit@5 (primary)** | 22 | 4.5% | 27.3% | −22.7 [−40.9, −4.5] | 0–5–17 | 0.063 |
| Hit@1 | 22 | 0.0% | 13.6% | −13.6 [−27.3, +0.0] | 0–3–19 | 0.250 |

- **Qloo, as Routed picks it** (lookUpOpeners in the tour's two biggest markets, then the pickSupport order)
  found a real opener for 1 of 22 artists: Chase B, for Travis Scott, at #2.
- **The model** found one for 6 of 22:
  - Doja Cat: Latto.
  - Green Day: The Linda Lindas.
  - Travis Scott: Don Toliver.
  - Pink: Brandi Carlile.
  - Japanese Breakfast: Ginger Root.
  - Nicki Minaj: Bia.

These are 2023–2025 tours that the model may have read about.

## Test 3: post-cutoff tours

**The cutoff.** NVIDIA's model card gives a pre-training cutoff of September 2025, a post-training cutoff of May
2026, and a release on June 4, 2026. Tours count only if they were announced after June 4, 2026.

**The set.**
- Wikipedia's 2026 and 2027 concert-tour categories held 185 pages, and all of them were walked.
- 13 tours qualified, which is above the 10-tour minimum and short of the 20 sought.
- The rest were skipped:

  | Reason for skipping | Pages |
  |---|---|
  | The article was created before the cutoff | 132 |
  | An announcement sentence dates before the cutoff | 15 |
  | The infobox doesn't name exactly one artist | 15 |
  | Fewer than 8 markets in one region | 7 |
  | No exact match on Qloo | 2 |
  | The artist already had a tour in the set | 1 |

Scores are R-precision against each tour's announced markets.

| Contrast | n | A | B | A − B, pts [95% CI] | wins–losses–ties | sign test p |
|---|---|---|---|---|---|---|
| **Qloo vs the model alone** | 13 | 46.4% | 50.9% | −4.6 [−11.7, +3.0] | 4–8–1 | 0.388 |
| **Qloo + population vs population** | 13 | 54.5% | 41.3% | +13.2 [+8.7, +17.4] | 11–0–2 | < 0.001 |
| The model alone vs population | 13 | 50.9% | 41.3% | +9.6 [+2.7, +16.4] | 10–1–2 | 0.012 |
| Qloo vs population | 13 | 46.4% | 41.3% | +5.1 [−2.6, +12.6] | 6–4–3 | 0.754 |
| Qloo + population vs the model alone | 13 | 54.5% | 50.9% | +3.6 [−0.8, +8.2] | 7–2–4 | 0.180 |
| The model + Qloo vs the model alone (exploratory) | 13 | 56.7% | 50.9% | +5.8 [+1.9, +10.1] | 7–1–5 | 0.070 |

| Ranking | Hits / picks (pooled) | Share |
|---|---|---|
| Population | 121 / 277 | 43.7% |
| The model alone | 150 / 277 | 54.2% |
| Qloo | 129 / 277 | 46.6% |
| Qloo + population (what Routed now ships) | 159 / 277 | 57.4% |
| The model + Qloo | 163 / 277 | 58.8% |

**The tours.**
- Flo, Beabadoobee, Lizzy McAlpine, Karol G, Garth Brooks, Take That, Role Model, Sugarland, Victoria Monét,
  Phoebe Bridgers, James Blunt, Jonas Brothers and Charli XCX.
- Four of them (Karol G, Take That, Sugarland, Phoebe Bridgers) qualified on the article-creation rule alone,
  because their prose gives no announcement date. Phoebe Bridgers' article was created on June 6, two days after
  the cutoff.

**Disclosure.** For Karol G, Nemotron 3 Ultra's answer ran out of tokens while repeating itself. Routed's model
chain (`lib/nebius.ts`) then answered with Nemotron 3 Super. This is how Routed itself behaves, so the answer is
kept as run.
- Leaving Karol G out moves "Qloo vs the model alone" from −4.6 to about −3.5 pts.
- No other row changes direction.

## Reading

These results do not support the claim that Qloo knows the room or the opener better than the model:
- In Test 1, Routed's Qloo room query found the real venue in the top 3 in 29 of 102 cities. The model alone found
  it in 75.
- Qloo's own popularity order, with no artist signal, found it in 35, so the artist signal made venue-picking
  slightly worse.
- In Test 2, Qloo's support pick matched a real opener for 1 of 22 tours; the model's matched 6.

Those two tests use 2023–2025 tours that the model may have read about. Even so, the model's lead on rooms looks
like general knowledge of each city's main rooms, not only memory of these tours. The fair conclusion is that
Qloo's place graph, filtered by Routed's tags, is a weak room picker for arena-sized acts.

Test 3 is the only test that removes memory of the tour itself, and on it the picture changes:
- On 13 tours announced after the model's release, the model's lead over Qloo shrinks from 12.7 pts (the
  head-to-head) to 4.6 pts, and that gap is not significant.
- The Qloo + population blend that Routed now ships beats population by 13.2 pts, for 11 of 13 artists with none
  worse.
- That blend is 3.6 pts ahead of the model alone, which is not significant.
- Adding Qloo to the model's own ranking lifts it by 5.8 pts (7–1–5, with an interval clear of zero but p = 0.07,
  exploratory).

Thirteen tours is a small sample. Read with that limit, Qloo's live taste data adds to the cities a model can name
for a tour it hasn't read about. It does not pick the rooms or the openers.
