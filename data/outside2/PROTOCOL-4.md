# Outside tests, round 4: the room Routed actually books

Pre-registered protocol. This file and `scripts/rooms4.ts` go into one commit before any Qloo call for this test is
made. The result is published whatever it says, in `rooms4.json` and `RESULTS.md`, in a later commit.

## Why

Round 2's Test 1 (`PROTOCOL.md`) scored Qloo's room ranking as `lookUpRooms` returns it. On that list, the real venue
was in the top 3 in 29 of 102 cities. The model alone found it in 75. Routed does not book from that list alone,
though. Since Oct 25 it has booked rooms this way:

1. **The agent's own picks.** The model names up to two rooms per city, and each one joins the city's candidates
   once Qloo finds it there by name (`findPlace`). The fans' affinity for it then comes from one `scoreRooms` call.
2. **Capacities and the booker's order.** The candidates are measured and graded (`roomGrade`), and the best grade
   is booked (`chooseRoom`).
3. **The Wikidata ladder.** When nothing on the list is a one-night fit, the city's Wikidata rooms at the right size
   are looked up on Qloo. A room is added only once Qloo finds it (`addLadderRooms`).

This test measures that pick. It also asks one question about Qloo's own list: does ordering Qloo's rooms by
popularity and fan affinity together do better than affinity alone?

## Subjects

These are round 2's venue subjects, unchanged (`venues-truth.json`):
- 34 artists and 102 cities;
- the same real venues and names;
- the same crowd size per tour.

Artists are walked in the file's order, which is the SHA-256 order of their names.

## What is reused, and what is new

**Reused (no new call):**
- Qloo's room list per city, from round 2's `lookUpRooms` cache (`.probe/outside2/venues/qloo`). It has each room's
  name, id, fan affinity and popularity.
- The popularity-only lists.
- The Wikidata ladders per market (`.probe/outside2/venues/ladder`).
- The model's five venues per city (`model-runs.json`, venues).
- Each artist's Qloo id, from round 2's search cache.

**New Qloo calls**, through `lib/qloo.ts` (its gate, backoff and daily allowance):
- `findPlace` searches, for the agent's named rooms and for ladder rooms;
- `scoreRooms` calls, for those rooms' fan affinity.

There are no model calls. The model's answers are reused from the cache.

**Capacities** are looked up the way Routed's `roomCapacity` does, in this order, minus two sources:
1. The hand-checked overrides (`capacityOverride`).
2. Wikidata's name search (`wikidataCapacity`).
3. The market's cached Wikidata ladder (`mergeLadder`).

The two sources left out are the live service's stored capacity index (kept in cloud storage) and its keyless web
search. Both are skipped so the test is reproducible and makes no paid or rate-limited calls. More rooms stay
unmeasured here than in a live run, which works against the shipped pick. Every lookup is cached under
`.probe/outside2/rooms4`.

## The shipped arm (S)

For each city, `scripts/rooms4.ts` replays `lib/agent/plan.ts` in this order:

1. **Candidates.** The cached Qloo list. Tags aren't in the cache, so name rules and `sizePrior` read names only.
2. **Agent-named rooms.**
   - The model's first two venues for the city (`NAMED_PER_CITY` = 2) stand in for the two rooms the live agent
     names in its shortlist call.
   - A name already on the list (`roomNameMatches`) costs nothing.
   - Otherwise `findPlace` searches Qloo, using the same checks as live: in the city, a room, and carrying the name.
   - Found rooms are scored for the artist's fans in one `scoreRooms` call per artist. Each is inserted into the
     list in affinity order and marked as the agent's.
3. **The agent's choice.** The booking call's choice is not replayed, since there are no model calls. The stand-in
   is the first of the agent's named rooms that Qloo confirmed, either found or already on the list. If neither was
   confirmed, there is no choice.
4. **Measuring**, as live:
   - The agent's rooms first. Then the likeliest of the rest by `candidatesBySize` (up to `PRE_MEASURE` = 4, skipping
     ones not worth measuring at this crowd), 4 at a time, stopping after a batch that finds a close fit.
   - Then the chosen room, or the first room worth measuring.
   - If that isn't a close fit, up to `MEASURE_PER_CITY` = 8 more, in `candidatesBySize` order, the same way.
5. **Check, then the ladder.** The city is checked with `roomCheck`. If it isn't bookable, or the crowd is 1,000 or
   more and the chosen room isn't a one-night fit, the ladder runs as `addLadderRooms` does:
   - Rooms already on the list take a matching ladder capacity.
   - Up to two ladder rungs not on the list are looked up with `findPlace`, in the booker's order.
   - Found ones are added with Wikidata's capacity and scored in one `scoreRooms` call.
6. **The booked room.** `roomCheck(rooms, choice ?? first, crowd)` picks it, where `first` is the room measured in
   step 4. This is `plan.ts`'s call. The arm's ranked list is `chooseRoom`'s full order with the same wanted room:
   grade, then the wanted room, then list order.

**S0 (sensitivity, secondary)** uses S's final candidates and capacities, with no agent choice. As in `plan.ts`,
the first room worth measuring then stands in among equal grades. It makes no extra calls.

## The popularity-and-affinity arm (PA)

This arm uses round 2's Qloo list for the artist (arm (a)), reordered:
1. Each room gets its rank by popularity and its rank by fan affinity on that list, best first.
2. The two ranks are averaged, with no weight to tune.
3. Ties go to Qloo's order.

It makes no calls.

## Metrics

Matching uses round 2's rule (`sameRoom`, copied into the script).

- **hit@1 per city:** the arm's first room is a real venue.
- **hit@3 per city:** a real venue is in the arm's top 3.

An artist's score is the share of their cities with a hit.

**Reference arms**, recomputed from the caches, are as in round 2:
- (a) Qloo's list as returned;
- (c1) popularity only;
- (c2) the biggest fitting Wikidata room;
- (b) the model alone.

## Contrasts

- **Primary:**
  1. S vs (b), hit@1. Does the room Routed books match the real venue as often as the model's first guess?
  2. S vs (b), hit@3.
  3. PA vs (a), hit@3. Does adding popularity to fan affinity help Qloo's own list?
- **Secondary:**
  - S vs (a), hit@3 and hit@1;
  - S0 vs (b), hit@1;
  - S vs (c2), hit@1;
  - PA vs (c1), hit@3;
  - PA vs (b), hit@3.
- **Also reported:**
  - pooled city counts;
  - where the booked room came from: Qloo's list, the agent's names or the ladder;
  - how many booked rooms were measured.

## Statistics

The same as rounds 1–3:
- per-artist paired differences;
- wins, losses and ties;
- an exact two-sided sign test;
- the mean with a 95% percentile bootstrap interval (10,000 resamples, seed 20261025).

## Budget and stopping

- **Qloo:** at most 320 requests for this test, counted in its own ledger (`.probe/outside2/rooms4/usage.json`).
  - Before each `findPlace`, the script reserves 2 requests (a search and, for a renamed room, its alias). Before
    each `scoreRooms`, it reserves 1.
  - It stops before the first step that could pass 320.
  - Only artists with every city completed are scored. The rest are listed as missing.
  - Searches are cached, so a rerun after a stop costs nothing for work already done.
- **Model:** 0 calls.
- **Wikidata:** free and unauthenticated. Lookups are cached and not capped.

## Limits

- **The agent's choice.** It is a stand-in (the model's first confirmed name), not the live booking call. S0 shows
  the pick without it.
- **The named rooms.** The model's names come from round 2's venue prompt (five likely venues for the crowd), not the
  live shortlist prompt (two rooms it would book). They are close, but not the same.
- **Capacities.** No stored index and no web search, as above.
- **Qloo's list.** It comes from round 2's cache with genres left empty, as round 2 ran it, so orchestra halls are
  always filtered. No artist in the set is classical.
- **The tours.** These are 2023–2025 tours the model may have read about, which favours every arm that uses the
  model's names, including S.
- **A single real venue.** A tour plays one room per city. Another room of the right size is a miss here, but it
  could be a fine booking.

## Amendment 1 (Oct 30, before scoring)

**What went wrong.** The first run (118 Qloo requests) left out 11 of the 34 artists:
- Queen + Adam Lambert, Queens of the Stone Age, Billy Joel, Sugababes, Nine Inch Nails, For King & Country;
- Chappell Roan, Ado, Troye Sivan, Addison Rae, Kim Petras.

Round 2 took their Qloo ids from the head-to-head's sample stage. Those ids were stripped from the committed files
(no Qloo ids are published), and round 2's search cache doesn't hold them. So the script found no cached artist and
skipped them. That is a gap in the script, not a result. No score of any arm had been computed when it was found.

**The fix.**
- Each of these artists is found again the way the head-to-head's notes say a later stage finds them: one Qloo
  artist search by name, then `pickArtist` (an exact name wins).
- That costs 1 request each, 11 in all, inside the same 320 cap and ledger.
- Everything else is unchanged.
- The re-found id is used for `findPlace` (where the artist only sets the orchestra-hall rule) and for `scoreRooms`
  (the fans' affinity for added rooms). Qloo's room list for these artists is still round 2's cached list.
