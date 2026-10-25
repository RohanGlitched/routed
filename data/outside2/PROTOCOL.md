# Outside tests, round 2: tests the model can't win from memory

Pre-registered protocol. This file, `scripts/outside2.ts`, and the two ground-truth files
`venues-truth.json` and `support-truth.json` went into one commit before any Qloo or model call for these tests
was made. Results are published whatever they say. They go in `results.json` and `RESULTS.md`, in a second
commit.

## Why

The head-to-head (`data/head-to-head/`, protocol commit 096d898, results 5d7c7c2) scored city rankings
against 49 real tours. Nemotron 3 Ultra alone beat Qloo by 12.7 pts. The likely reason is that the model has
read these tours' announcements. These three tests ask questions where memorising past tours helps less, and
where Qloo's live taste data should matter:

1. **Venues.** Which room in a city?
2. **Support acts.** Who opens?
3. **Post-cutoff tours.** Which cities, for tours announced after the model was released?

The tests run in that order of priority. Each one has its own cap on Qloo requests, so an early test can't use
up a later test's share.

## Common rules

- **Model.** `nvidia/Nemotron-3-Ultra-550b-a55b` on Nebius Token Factory. This is the model Routed uses
  (`lib/nebius.ts` MODELS.agent). Each call is a strict-JSON call with thinking off, the same as Routed.
  - A failed call is retried once. If it fails again, it is reported as missing.
  - Nothing is re-run to change an answer.
- **Qloo.** Calls go through `lib/qloo.ts`, which has the request gate (3 in flight, 230 ms apart) and backoff
  on 429s.
  - Every response is cached under `.probe/outside2/`. That folder is gitignored, and raw Qloo data is never
    published.
  - The published files carry only derived room and artist names, ranks and hit counts.
- **Statistics.** Same as the head-to-head (`lib/headtohead.ts`). Every contrast reports:
  - the per-artist paired differences;
  - wins, losses and ties;
  - an exact two-sided sign test;
  - the mean difference with a 95% percentile bootstrap interval (10,000 resamples, seed 20261025).
- **Order and stopping.** Each test walks its artists in the order of the SHA-256 of the artist's name.
  - A test stops before the first step that could pass its Qloo cap.
  - Only artists with every arm answered are scored. The others are listed as missing.
- **Budget** (owner-approved hard caps):

  | Item | Cap |
  |---|---|
  | All Qloo requests | 400 |
  | Venues | 235 Qloo requests |
  | Support | 65 Qloo requests |
  | Post-cutoff, sample and run together | 90 Qloo requests |
  | Model spend | $1.50 at list price ($1 in, $3 out per million tokens, as in `scripts/head-to-head.ts`) |

  - The three Qloo test caps sum to 390, which leaves room for retries.
  - The script refuses any model call whose estimate would take the spend past $1.40.
  - Expected spend is about 226 + 63 + 45 Qloo requests and well under $0.30 of model spend.
- **Done before this commit.** The `truth` stage ran before this commit, to size the budget. It reads only
  Wikipedia and Wikidata. No Qloo or model call for these tests had been made, and no method's answer had been
  seen. The ground truth it wrote is committed here.

## Test 1: venues (priority 1)

**Subjects.** The 49 head-to-head artists, with the same tour, region and scored markets.
- A tour is used when its Wikipedia article's date tables name venues.
  - Held-out artists use the same revision as the head-to-head.
  - Bench artists qualify only when `data/real-tours.json` lists a Wikipedia article among the tour's sources.
- Press-only listings are skipped. Copying venues from them by hand would let us choose which ones count.
- For bench artists, only rows in the markets of the leg in `data/real-tours.json` count.
- Rows are read by the head-to-head's rule (`lib/wikitours.ts` showRows), copied into the script with the venue
  link and opener column added. Cancelled and postponed rows, cancelled sections and festival rows are left
  out.

**Real venues.** For each market, the venue names on its rows. A venue's names are:
- the cell text;
- the link target, without the "(City)" disambiguator;
- the Wikidata English label and aliases, reached through the link. Aliases include former names, such as Staples
  Center for Crypto.com Arena.

**Crowd size.** Routed always books for a stated crowd, so every method is given one. It is the median Wikidata
maximum capacity (P1083) of the tour's linked venues in the scored rows, rounded to 100.
- A tour needs at least 2 measured venues. Otherwise it is skipped.
- This tells every method the size class of the rooms. It favours the Wikidata baseline (c2), because the real
  venues are measured there by construction.

**Cities tested.** Up to 3 markets per artist that have a named venue. They are taken in the order of
SHA-256(`artist|marketId`).

**Result of the truth stage.** 34 artists qualify (30 held-out, plus Japanese Breakfast, Turnstile, Clairo and
Ghost from the bench), with 102 cities. 15 bench artists are skipped (press listings only).

**Methods.** Each method gives an ordered list of rooms per city:
- **(a) Qloo.** Routed's own lookup, `lib/agent/tools.ts` lookUpRooms(artist, city, draw).
  - It uses the crowd tier's place tags (`venueTier`), POINT plus radius (`cityArea`), and the artist as the
    signal, with take 25.
  - It applies Routed's room filters: isRoom, nearCity, and orchestra halls out.
  - For crowds of 3,000–9,000 it also asks for arenas and amphitheatres. Their rooms follow the first list.
  - The list is in Qloo's order (fan affinity).
  - Genres are left empty for every artist, so orchestra halls are always filtered. No artist in the set is
    classical.
- **(a2) Qloo in Routed's measuring order.** The same rooms reordered by `candidatesBySize`: by popularity for
  crowds of 1,000 or more. This is secondary and costs no extra calls.
- **(b) The model alone.** One call per artist, listing the artist's tested cities by id and label and the crowd
  size. It returns 5 venues per city, most likely first. The prompt is `venuePrompt` in the script.
- **(c1) Popularity only.** The same Qloo request as (a), with the same tags, area, filters and second query,
  but with no artist signal. Each list is sorted by Qloo popularity.
  - It is shared by every artist with the same city and crowd tier.
  - If Qloo refuses a request with no signal, (c1) is reported as unavailable for that city.
- **(c2) Biggest fitting room on Wikidata.** The market's Wikidata room ladder (`wikidataRoomsNear`, 30 km),
  filtered by `roomLadder`. Rooms at 60–250% of the crowd come first, biggest first. Then the rest of the ladder
  follows, closest in size first. It makes no Qloo calls.

**Matching.** A listed room is a real venue when one of the venue's names and the listed name are equal after
folding (case, accents, punctuation, leading "the"). They also match when one name's distinctive words are a
subset of the other's. Distinctive words exclude generic ones like theatre, hall, arena and centre, the list in
`lib/agent/capacity.ts`. Two conditions apply:
- the smaller set must have at least 2 words, or the larger set at most 2;
- so "The Forum" matches "Kia Forum", and "The O2" doesn't match "O2 Academy Brixton".

The rule is the same for every method. It is `sameRoom` in the script.

**Metrics.** Per city, a hit@3 is a real venue in the method's top 3. An artist's score is the share of their
tested cities with a hit.
- **Primary contrasts:**
  - (a) Qloo vs (c1) popularity only: does the artist's taste data pick the room?
  - (a) Qloo vs (b) the model alone.
- **Secondary contrasts:**
  - (b) vs (c1);
  - (a) vs (c2);
  - (b) vs (c2);
  - (a2) vs (c1);
  - hit@1 for (a) vs (b) and for (a) vs (c1);
  - MRR@5 (the reciprocal rank of the first real venue within the top 5, else 0) for (a) vs (b).
- **Also reported:** pooled city counts, how often the real venue is listed at all, and its median rank when it
  is listed.

## Test 2: support acts (priority 2)

**Subjects.** The same tours as Test 1, with the same articles and rows.
- **Ground truth.** The acts in the date tables' opening-act column in the scored rows. A column counts when its
  header starts "Opening", "Support" or "Special guest". The names are the links, else the cell text split on
  commas, semicolons and line breaks.
- When there is no such column, the bullet list under a section headed "Opening acts", "Supporting acts" or
  "Special guests" is used, for the whole tour.
- The headliner is left out.
- **Result of the truth stage.** 22 artists have openers on file.

**Methods.**
- **Qloo, as Routed picks it.** Routed looks up openers in every stop (`lookUpOpeners`) and then takes one
  support act for the tour (`pickSupport`). The test runs `lookUpOpeners` in the real tour's two most populous
  scored markets.
  - The lookup uses the headliner's popularity window, POINT plus city signal, and the openerProblem filters.
  - The candidates are ranked as `pickSupport` ranks them when the agent casts no votes: seen in the most cities
    first, then the higher summed affinity. Ties go to the first seen.
  - The top 5 are kept.
  - For held-out artists, the headliner's popularity and genres come from one Qloo search. For bench artists they
    come from the stored benchmark tour.
- **The model alone.** One call per artist with the artist and the region. It returns 5 names, most likely first.
  The prompt is `supportPrompt`.

**Matching.** Names are equal after folding ("&" is "and", a leading "the" is dropped). A link target counts as
an alias.

**Metrics.**
- Primary: hit@5, meaning a real opener is in the top 5. Qloo vs the model, paired per artist.
- Secondary: hit@1.
- No looser check (such as same tier or same genre) is registered, so none is reported.

## Test 3: post-cutoff tours (priority 3)

**Cutoff.** The NVIDIA model card for Nemotron 3 Ultra
(huggingface.co/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16, read Oct 25, 2026) gives these dates:
- Pre-training data: cutoff September 2025.
- Post-training data: cutoff May 2026.
- Release: June 4, 2026.

The test uses the latest of these: tours announced **after 2026-06-04**.

**Sampling.** Every page in Wikipedia's "2026 concert tours" and "2027 concert tours" categories is fetched
once and saved in `categories.json`. The pages are ordered by the SHA-256 of the title and walked in that order.
A tour is taken when all of these hold:
1. The infobox names exactly one artist, and that artist has no earlier tour taken.
2. The article was created after 2026-06-04, judged by its first revision's timestamp.
3. Every date in the article's prose sentences that contain "announc" is after 2026-06-04.
   - Refs, comments, tables and infobox lines are left out.
   - A month with no day counts as the 1st, and a year on its own ("in 2025") as January 1.
   - When no such sentence has a date, rule 2 alone decides.
4. The date tables give at least 8 touring markets in one region, by the head-to-head's rule (`showRows`,
   `marketsByRegion`, the region with the most markets).
   - Announced shows count, including future ones.
   - Cancelled and postponed rows and festival rows don't count.
5. Qloo's search finds the artist by exact name.

The first 20 taken are the set. Every skipped page is saved with its reason.
- Head-to-head artists may appear with a new tour.
- If fewer than 10 tours qualify after the whole category has been walked, that is reported plainly, and what
  exists is scored and published.

**Methods.** These are as in the head-to-head:
- **P:** population.
- **M:** the model alone, with the head-to-head's `rankPrompt` verbatim (50 cities). Names are placed on markets
  by name, else by Wikipedia coordinates within 60 km.
- **Q:** one region heatmap call and `scoreCities`.
- **Q+P:** the rank-average blend (`blendRanking`).
- **Exploratory:** M+Q blended the same way (`blendTwo`).

**Metric.** R-precision against the tour's markets.
- **Primary:** Q vs M, and Q+P vs P.
- **Secondary:** M vs P, Q vs P, and Q+P vs M.
- **Also reported:** "beyond the biggest" counts.

## Limits stated up front

- A past tour is one booker's answer. It was made with ticket data neither side has.
- The model may know these artists' earlier tours. For venues and openers, it may also have read these very
  tours, since most are from 2023–2025. Only Test 3 removes memorisation of the tour itself.
- Qloo's signals may include check-ins at these very shows, which favours Qloo.
- Wikipedia tour articles lean towards big acts. That favours the popularity baselines in Test 1 and the
  population prior in Test 3.
- Venue names change. The aliases help, but a miss can be a naming miss. The rule is the same for every method.
- The crowd size comes from the real venues' capacities. It is the same hint for every method, and it favours
  (c2).
