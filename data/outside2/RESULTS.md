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

## The model + Qloo against the model alone (post hoc, exploratory, not pre-registered)

**Added Oct 30.** Script: `scripts/model-plus-qloo.ts`. Numbers: `model-plus-qloo.json`. Nothing here was fixed before
the data were seen, so it shows a direction, not a tested claim.

**The question.** Does Qloo add anything to the model's own city ranking? Each market's place in the model's ranking
and its place in Qloo's heatmap ranking are averaged, with no weight to tune and ties going to the bigger city
(`blendTwo` in `lib/headtohead.ts`). The blend is scored against the model's ranking alone by R-precision, on the
13 post-cutoff tours above and the 49 older tours of the head-to-head.

**How it was run.**
- Offline only, from the cached rankings: the model's answers in the two committed `model-runs.json` files, Qloo's
  rankings as stored market ids in the gitignored `.probe` caches, and the Wikipedia coordinates the published runs
  had already fetched to place the model's towns.
- The script replaces `fetch` with a function that throws and checks at the end that it was never called. It made
  0 Qloo calls, 0 model calls and 0 network calls.
- Both published tests already carried this contrast as an exploratory row, added after their results were seen.
  The script recomputes both from the caches, and every artist's hits match the published rows (13 of 13 and 49 of
  49). The adversary's "+5.8 pts (7–1–5)" is that post-cutoff row; the head-to-head's "the model + Qloo = the model"
  is the −0.8 row.
- The bootstrap uses each test's own seed (20261025 for the post-cutoff tours, 20261018 for the head-to-head), so
  the rows match the published ones to the digit. The pooled row uses 20261025.

| Tours | n | The model + Qloo | The model alone | Difference, pts [95% CI] | wins–losses–ties | sign test p |
|---|---|---|---|---|---|---|
| Announced after the model's release | 13 | 56.7% | 50.9% | +5.8 [+1.9, +10.1] | 7–1–5 | 0.070 |
| Older tours, 2024–2025 (head-to-head) | 49 | 57.2% | 58.0% | −0.8 [−3.2, +1.7] | 13–20–16 | 0.296 |
| Older tours, the 19 benchmark artists | 19 | 47.4% | 46.2% | +1.2 [−1.6, +4.6] | 4–7–8 | 0.549 |
| Older tours, the 30 held-out artists | 30 | 63.4% | 65.5% | −2.1 [−5.5, +1.3] | 9–13–8 | 0.523 |
| Both sets together | 62 | 57.1% | 56.5% | +0.6 [−1.6, +2.8] | 20–21–21 | 1.000 |

Pooled hits: after the cutoff, 163 of 277 cities for the blend against 150 for the model; on the older tours, 762
of 1,271 against 753.

**Reading.** On tours the model can't have read, adding Qloo to its ranking found more of the real cities for 7 of
13 artists and fewer for 1. The interval is clear of zero, but the sign test is not significant (p = 0.07), and the
contrast was chosen after the data. On older tours, which the model may remember, the blend is level with the model
alone. That fits the reading above: Qloo's data helps where the model's memory runs out, and adds little where the
model has read the answer. A fresh, pre-registered test on new tours is the way to settle it.

## Round 3: secondary markets on the post-cutoff tours (protocol committed before scoring, from offline caches)

**Sources.**
- Protocol: `data/outside2/PROTOCOL-3.md`, committed in d5991e2 before the test was scored: 22 seconds before the
  results (25a4f02), on caches already on disk. So it fixed the metric and contrasts before any score was computed,
  not before the data were collected; it is not pre-registered in the stronger sense Round 4 is.
- Script: `scripts/model-plus-qloo.ts secondary`.
- Numbers: `secondary-markets.json`.
- Cost: offline from round 2's caches, with 0 Qloo requests, 0 model calls and 0 network calls.

**The test.** These are the same 13 tours and the same five rankings as Test 3, with each region's 25 biggest markets
left out of both the ranking and the tour. The question is how many of the remaining markets the tour announced each
ranking's top R found, R being the tour's remaining markets. Every tour had at least 4 (median 11), so all 13 were
scored.

| Contrast | n | A | B | A − B, pts [95% CI] | wins–losses–ties | sign test p |
|---|---|---|---|---|---|---|
| **Qloo vs the model alone** | 13 | 32.7% | 46.4% | −13.6 [−24.3, −4.3] | 3–8–2 | 0.227 |
| **Qloo + population vs population** | 13 | 44.6% | 32.5% | +12.1 [+4.8, +20.9] | 8–1–4 | 0.039 |
| Qloo vs population | 13 | 32.7% | 32.5% | +0.2 [−9.9, +11.7] | 5–6–2 | 1.000 |
| The model alone vs population | 13 | 46.4% | 32.5% | +13.9 [+4.0, +23.9] | 9–1–3 | 0.021 |
| Qloo + population vs the model alone | 13 | 44.6% | 46.4% | −1.7 [−8.1, +4.6] | 2–3–8 | 1.000 |
| The model + Qloo vs the model alone | 13 | 45.2% | 46.4% | −1.2 [−8.1, +5.1] | 4–3–6 | 1.000 |

The first two rows (in bold) are the primary contrasts; the rest are secondary.

| Ranking | Hits / picks (pooled) | Share |
|---|---|---|
| Population | 48 / 148 | 32.4% |
| The model alone | 61 / 148 | 41.2% |
| Qloo | 44 / 148 | 29.7% |
| Qloo + population (what Routed ships) | 61 / 148 | 41.2% |
| The model + Qloo | 64 / 148 | 43.2% |

**Reading.** The test was meant to find where Qloo beats the model, and it didn't:
- Outside the 25 biggest markets, Qloo's heatmap ranking found fewer of the announced cities than the model alone:
  13.6 pts fewer, worse for 8 artists and better for 3. The interval is clear of zero, though the sign test is not
  significant (p = 0.23).
- On its own, Qloo's ranking is level with population on these markets.
- The blend Routed ships beats population by 12.1 pts (8–1–4, p = 0.039), but so does the model alone (+13.9).
- The blend is level with the model (−1.7, 2–3–8).
- The model + Qloo blend's post hoc +5.8 pts on whole tours does not carry over to the smaller markets (−1.2).

So on tours it can't have read, the model still names the smaller markets of a big act's tour better than Qloo's fan
map does. A likely reason, not tested here: most of these 13 are arena and theatre tours, whose smaller stops are
metros a model knows. Qloo's whole-tour gain over population comes from re-ordering cities, not from finding small ones the
model misses.

## Round 4: the room Routed actually books (pre-registered)

**Sources.**
- Protocol: `data/outside2/PROTOCOL-4.md`, committed in 7d132d3 before any Qloo call for this test.
- Amendment 1: committed in fbffff9 before scoring. The first run had skipped 11 artists whose Qloo ids were never
  cached, so each was found again with one search.
- Script: `scripts/rooms4.ts`.
- Numbers: `rooms4.json`, with every city, list, booked room, its source and its Wikidata capacity.

**Spend.**
- 190 of 320 Qloo requests: name searches for the agent's rooms and ladder rooms, `scoreRooms` calls, and the
  11 artist searches.
- 0 model calls. The model's venue answers are round 2's.
- Wikidata lookups for capacities are free.
- All 34 artists and 102 cities were scored.

**The test.** The same 102 cities as Test 1. Routed's room flow was replayed on round 2's cached Qloo lists:
1. The agent's two named rooms per city were looked up on Qloo by name.
2. The rooms were measured (overrides and Wikidata only).
3. The Wikidata ladder ran where no room was a one-night fit.
4. The size rule booked one room.

The question is whether that room is the one the artist really played.

| Contrast | n | A | B | A − B, pts [95% CI] | wins–losses–ties | sign test p |
|---|---|---|---|---|---|---|
| **Routed's booked room vs the model alone, hit@1** | 34 | 45.1% | 53.9% | −8.8 [−19.6, +2.0] | 5–12–17 | 0.143 |
| **Routed's room order vs the model alone, hit@3** | 34 | 55.9% | 73.5% | −17.6 [−30.4, −5.9] | 5–15–14 | 0.041 |
| **Qloo by popularity and affinity vs Qloo by affinity, hit@3** | 34 | 30.4% | 28.4% | +2.0 [+0.0, +4.9] | 2–0–32 | 0.500 |
| Routed's room order vs Qloo's list, hit@3 | 34 | 55.9% | 28.4% | +27.5 [+15.7, +39.2] | 20–2–12 | < 0.001 |
| Routed's booked room vs Qloo's first room, hit@1 | 34 | 45.1% | 15.7% | +29.4 [+18.6, +40.2] | 19–1–14 | < 0.001 |
| Routed's booked room with no agent choice vs the model alone, hit@1 | 34 | 41.2% | 53.9% | −12.7 [−23.5, −2.0] | 5–16–13 | 0.027 |
| Routed's booked room vs the biggest fitting Wikidata room, hit@1 | 34 | 45.1% | 26.5% | +18.6 [+9.8, +28.4] | 16–2–16 | 0.001 |
| Qloo by popularity and affinity vs Qloo popularity only, hit@3 | 34 | 30.4% | 34.3% | −3.9 [−9.8, +1.0] | 1–4–29 | 0.375 |
| Qloo by popularity and affinity vs the model alone, hit@3 | 34 | 30.4% | 73.5% | −43.1 [−54.9, −31.4] | 1–26–7 | < 0.001 |

The first three rows (in bold) are the primary contrasts; the rest are secondary.

| Method | Cities | Real venue at #1 | In top 3 | Listed at all |
|---|---|---|---|---|
| Routed's booked room, then its order | 102 | 46 | 57 | 70 |
| The same, with no agent choice | 102 | 42 | 55 | 70 |
| Qloo's rooms by popularity and affinity together | 102 | 19 | 31 | 39 |
| Qloo, the artist's room ranking (round 2) | 102 | 16 | 29 | 39 |
| Qloo places by popularity, no artist (round 2) | 102 | 25 | 35 | 49 |
| Biggest fitting room on Wikidata (round 2) | 102 | 27 | 38 | 42 |
| The model alone (round 2) | 102 | 55 | 75 | 78 |

The round 2 rows were recomputed from the caches and match Test 1 exactly.

**Where the booked room came from.** A room was booked in 99 of 102 cities:
- 62 came from Qloo's own list;
- 33 from the agent's names, found on Qloo;
- 4 from the Wikidata ladder, found on Qloo.

59 of the 99 were the agent's choice, and 80 had a measured capacity. Of the 46 that were the real venue, 22 came
from Qloo's list, 22 from the agent's names and 2 from the ladder.

**On crowds under 5,000** (7 tours, 21 cities; a descriptive split, not pre-registered):
- Routed's booked room was the real venue in 7 cities, the model's first guess in 6.
- Qloo's first room was the real venue in 1.

**Reading.**
- The room Routed books is far better than Qloo's list on its own: 46 of 102 at #1 against 16. The agent's names,
  the measuring and the size rule do that work.
- It still trails the model's first guess, 46 against 55. That gap is not significant at #1 (p = 0.14), but it is
  at top 3 (p = 0.04).
- In 18 cities the model's first guess was the real room and Routed booked another. The misses fall into three
  kinds:
  - **Stadium tours** (Billy Joel, Green Day, Pink), where no stadium was among Routed's candidates and it booked an
    arena or a smaller room.
  - **A real room ranked below another fit.** The size rule put the real room behind another measured fit: The
    Anthem behind CareFirst Arena or the DC Armory in Washington, the Ryman behind War Memorial Auditorium in
    Nashville, Oslo Spektrum behind Unity Arena.
  - **Booked rooms that stayed unmeasured** (Hagan Arena, the Theatre of the Living Arts, AO Arena).
- Ordering Qloo's rooms by popularity and affinity together moves Qloo's list only slightly (+2.0 pts, 2–0–32). It
  stays below popularity alone.
- These are 2023–2025 tours that the model may have read about. Rooms are measured here without the live service's
  stored index or web search, so 19 booked rooms stayed unmeasured.

## Round 5: club and theatre acts only (protocol committed before scoring, from offline caches)

**Sources.**
- Protocol: `data/outside2/PROTOCOL-5.md`, committed in 2e915c4 before the subset was scored. The only thing computed
  before it was each tour's room size, and so who is in the subset.
- Script: `scripts/indie-subset.ts`. Rules: `medianCapacity` and `isClubAndTheatre` in `lib/headtohead.ts`.
- Numbers: `indie-subset.json`, with every tour's room size, where it came from, and its published hits.
- Cost: 0 Qloo requests, 0 model calls and 0 network calls. The per-tour hits are the published ones
  (`data/head-to-head/results.json`, `data/outside2/results.json`), which `scripts/model-plus-qloo.ts` already
  checked against the caches.

**The test.** Of the 62 tours (the head-to-head's 49 and the 13 announced after the model's release), keep the ones
whose real rooms held 3,000 or fewer: the median Wikidata capacity of the tour's venues where at least 2 are
measured, else, for the 15 benchmark tours with no Wikipedia article, the usual crowd fixed in `scripts/bench.mjs` on
Oct 8. 20 tours qualify: 19 older ones (6 measured, 13 stated) and 1 post-cutoff tour (Flo). The same five rankings,
scored by R-precision.

| Contrast | n | A | B | A − B, pts [95% CI] | wins–losses–ties | sign test p |
|---|---|---|---|---|---|---|
| **Qloo + population vs population** | 20 | 50.3% | 42.4% | +7.9 [+3.8, +11.9] | 14–2–4 | 0.004 |
| **Qloo + population vs the model alone** | 20 | 50.3% | 52.1% | −1.8 [−5.9, +2.6] | 5–9–6 | 0.424 |
| Qloo vs the model alone | 20 | 45.1% | 52.1% | −7.0 [−12.3, −1.7] | 5–11–4 | 0.210 |
| Qloo vs population | 20 | 45.1% | 42.4% | +2.7 [−3.9, +9.2] | 11–5–4 | 0.210 |
| The model alone vs population | 20 | 52.1% | 42.4% | +9.7 [+4.2, +15.2] | 14–3–3 | 0.013 |
| The model + Qloo vs the model alone | 20 | 54.6% | 52.1% | +2.5 [−0.5, +6.0] | 5–5–10 | 1.000 |

The first two rows (in bold) are the primary contrasts; the rest are secondary.

| Group | n | Qloo + population vs population | Qloo + population vs the model alone | Qloo vs the model alone |
|---|---|---|---|---|
| Club and theatre tours (above) | 20 | +7.9, 14–2–4, p = 0.004 | −1.8, 5–9–6, p = 0.42 | −7.0, 5–11–4, p = 0.21 |
| Of those, the older tours | 19 | +7.4, 13–2–4, p = 0.007 | −2.5, 4–9–6, p = 0.27 | −7.7, 4–11–4, p = 0.12 |
| Of those, room size measured, not stated | 7 | +12.8, 6–0–1, p = 0.031 | −0.2, 3–2–2, p = 1.00 | −6.0, 2–3–2, p = 1.00 |
| For comparison: the tours over 3,000 (30 older, 10 post-cutoff) | 40 | +9.3, 32–5–3, p < 0.001 | −3.3, 14–23–3, p = 0.19 | −13.4, 6–32–2, p < 0.001 |

The one post-cutoff tour (Flo) is in the first row only; on its own it is a single pair: the blend found 12 of its
17 markets, population 9 and the model 10.

| Ranking | Hits / picks (pooled, 20 tours) | Share |
|---|---|---|
| Population | 206 / 443 | 46.5% |
| The model alone | 248 / 443 | 56.0% |
| Qloo | 213 / 443 | 48.1% |
| Qloo + population (what Routed ships) | 248 / 443 | 56.0% |
| The model + Qloo | 261 / 443 | 58.9% |

**Reading.**
- For club and theatre acts, the blend Routed ships finds more of the real cities than city size: 7.9 pts more,
  better for 14 tours and worse for 2 (p = 0.004).
- It is level with the model alone (−1.8 pts, 5–9–6, not significant), and pooled over all 443 picks each found 248
  of the real cities.
- Qloo's ranking on its own trails the model by 7.0 pts (5–11–4, not significant). On the tours over 3,000 the same
  gap is 13.4 pts (6–32–2), so it narrows for the smaller acts, though that comparison is descriptive, not a test.
- 19 of the 20 tours are older ones the model may have read about, and 13 of the 20 room sizes are stated, not
  measured (in the 4 benchmark tours that have both, the stated crowd was below the measured median every time). On
  the 7 measured tours the blend's lead over size holds (+12.8, 6–0–1, p = 0.031).


## Round 6: the street level (protocol committed before scoring, from offline caches; a pilot, too small to test)

**Sources.**
- Protocol: `data/outside2/PROTOCOL-6.md`, committed in 034ad6e before anything was scored. The only thing computed
  before it was which real rooms can be placed on a cached heatmap (names and coordinates, no distance to any tile).
- Script: `scripts/street-level.ts`. Helpers: `lowerMedian`, `streetSpot`, `tileReachKm` and `shareFarther` in
  `lib/headtohead.ts`, on the day sheet's own rules (`lib/geo/local.ts`).
- Numbers: `street-level.json`, with every case and every room left out and why. No tiles or coordinates are kept.
- Cost: 0 Qloo requests, 0 model calls and 0 network calls.

**The test.** The only street heatmaps on disk are the ones stored with the tours, so the cases are the poster
wall's artists. 18 real rooms (from `venues-truth.json`, the cached tour articles and `flagship-reality.json`) fall
in a city with a stored heatmap for that artist; 9 can be placed and have 3 or more other candidate rooms. On that
artist's heatmap for that city: is the real room nearer the hottest tile than the city's other candidate rooms
(their lower median), and than the city centre?

| Contrast | n | Mean difference [95% CI] | real room nearer–farther–level | sign test p |
|---|---|---|---|---|
| **Real room vs the city's other candidate rooms, km to the hottest tile** | 9 | −2.3 km [−6.8, +0.6] | 5–4–0 | 1.00 |
| Real room vs the city centre, km to the hottest tile | 9 | −3.0 km [−8.1, +0.8] | 2–7–0 | 0.18 |
| Real room vs the other rooms, tile strength within 0.35 km | 9 | +0.10 [−0.34, +0.53] | 4–3–2 | 1.00 |

A positive difference means the real room is nearer the hottest tile (or on a hotter tile). The first row is the
primary contrast.

| Artist | City | Real room | Real room, km | Other rooms, km (lower median) | City centre, km | Other rooms farther |
|---|---|---|---|---|---|---|
| Japanese Breakfast | Philadelphia | Metropolitan Opera House | 1.4 | 1.8 (of 14) | 1.3 | 71% |
| Turnstile | San Francisco | Bill Graham Civic Auditorium | 0.2 | 1.1 (of 12) | 0.6 | 100% |
| Japanese Breakfast | Austin | Moody Theater | 0.9 | 2.0 (of 13) | 0.4 | 69% |
| Japanese Breakfast | Chicago | The Salt Shed | 1.5 | 3.4 (of 14) | 7.0 | 93% |
| Japanese Breakfast | San Francisco | SF Masonic Auditorium | 3.3 | 2.4 (of 16) | 1.5 | 25% |
| Japanese Breakfast | Denver | Mission Ballroom | 4.1 | 2.7 (of 15) | 0.4 | 33% |
| Turnstile | Philadelphia | Mann Center for the Performing Arts | 6.6 | 2.1 (of 15) | 1.3 | 13% |
| Sierra Ferrell | Portland | McMenamins Edgefield | 21.2 | 2.7 (of 8) | 0.5 | 0% |
| Sierra Ferrell | Pittsburgh | Stage AE Outdoors | 1.3 | 1.9 (of 13) | 0.3 | 54% |

On average 51% of the other rooms sat farther from the hottest tile than the real room (a room picked at random
scores 50%). 6 of the 9 real rooms are in the fans' area as the day sheet defines it (within 1.5 km of the hottest
tile, or on a tile of strength 0.9 or more).

**Reading.**
- No evidence either way. The real room beat the other rooms' median in 5 of 9 cities and lost in 4 (p = 1.00); on
  average it sat as near the hottest tile as a room picked at random from Qloo's own list for that artist.
- The city centre is nearer the hottest tile than the real room in 7 of 9 cities (p = 0.18). The heatmap's hottest
  tile mostly sits downtown, and several real rooms are outdoor or suburban (Edgefield, in Troutdale, is 21 km from
  it), so the mean differences are pulled by one or two far rooms.
- 9 cases from 3 artists (Japanese Breakfast is 5) cannot test the claim: with 9 pairs only 8–1 or 9–0 reaches
  p < 0.05. Until the larger run, the street layer is untested, not shown.

**The run that would settle it, sized and not run (needs the owner's OK).** The room test's 34 artists and 102
cities already have the real room and the city's candidate rooms (round 4's cache). Each city needs the artist's
street heatmap: 1 Qloo request per artist and city, about 102 requests and 0 model calls. 53 of the 102 can place
the real room from today's caches; reading the other rooms' coordinates from Wikidata costs no Qloo request. That
is a test of about 53 to 100 cases.
