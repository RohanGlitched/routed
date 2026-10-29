# Outside tests, round 3: secondary markets on the post-cutoff tours

Pre-registered protocol. This file, the scoring stage `secondary` in `scripts/model-plus-qloo.ts`, and the metric
`secondaryRPrecision` in `lib/headtohead.ts` (with its test in `test/headtohead.test.ts`) go into one commit before
the test is scored. The result is published whatever it says, in `secondary-markets.json` and `RESULTS.md`, in a
later commit.

## Why

Routed's pitch is that Qloo finds the cities size and memory miss. Round 2's post-cutoff test (PROTOCOL.md, Test 3)
scored whole tours. Every tour also plays the region's biggest cities, where population, the model and Qloo all
agree. This test asks the narrower question: leave out the region's 25 biggest markets. On the cities that are left,
which ranking finds more of the ones a tour really announced? That is where a model's general knowledge is thinnest
and where Qloo's fan data should matter most.

## What is already known, stated up front

- The 13 post-cutoff tours, the model's answers and Qloo's rankings were all collected for round 2. Their
  whole-tour scores are published (`RESULTS.md`, Test 3), and so is the post hoc model + Qloo row (Oct 30).
- Before writing this file, the only thing computed for this test was how many of each tour's markets fall outside
  its region's 25 biggest, to set the minimum below. That count uses only the ground truth and population, no method's
  answer. All 13 tours have at least 4 such markets.
- No method's score on secondary markets has been computed or seen.

## Subjects

The 13 tours announced after the model's release (`post-cutoff.json`, taken in round 2). Their markets, regions and
sources are as committed.

The adversary review suggested adding tours announced since Oct 25. That would need new model calls, which this
round doesn't make, so the set stays at 13.

## Rankings

These are the same rankings, from the same cached answers, as round 2's Test 3:

- **P:** population.
- **M:** the model alone. These are the cities in `model-runs.json` (postcut), placed on markets by name, else by the
  Wikipedia coordinates the round-2 run cached (within 60 km).
- **Q:** Qloo's heatmap ranking. It is the stored market ids from round 2's one region heatmap call per artist,
  through `scoreCities`.
- **Q+P:** the rank-average blend Routed ships (`blendRanking`).
- **M+Q:** the model and Qloo averaged the same way (`blendTwo`).

Each ranking is completed by population past its own end (`completeRanking`), on the full region, exactly as in
round 2. Blends are computed on the full region, then filtered.

## Metric

**Secondary-market R-precision** (`secondaryRPrecision`):
1. Drop the region's 25 biggest markets by population (`populationRanking(region).slice(0, 25)`) from both the
   ranking and the tour.
2. The ranking keeps its order.
3. R is the number of the tour's markets left.
4. The score is how many of the ranking's first R remaining markets the tour announced, over R.

A tour needs R ≥ 3 to be scored. Tours below that are listed as skipped. All 13 are expected to qualify.

## Contrasts

- **Primary:**
  - Q vs M. Does Qloo's ranking find secondary markets better than the model's?
  - Q+P vs P. Does the shipped blend beat size among the smaller markets?
- **Secondary:**
  - Q vs P;
  - M vs P;
  - Q+P vs M;
  - M+Q vs M.
- **Also reported:** pooled hits over picks for each ranking.

## Statistics

The same as rounds 1 and 2 (`lib/headtohead.ts`):
- per-artist paired differences;
- wins, losses and ties;
- an exact two-sided sign test;
- the mean difference with a 95% percentile bootstrap interval (10,000 resamples, seed 20261025, round 2's seed).

## Budget

- 0 Qloo requests and 0 model calls.
- Offline from round 2's caches. `fetch` is replaced by a function that throws, and the script checks that it was
  never called.

## Limits

- 13 tours is a small sample. With 13 pairs, the sign test needs at least 11–2 (ties dropped) to reach p < 0.05.
- These tours were already scored as whole tours, so this is a second look at the same data. It is pre-registered
  only in the sense that the secondary-market scores had not been computed when this was committed.
- The cut at 25 is per region, so it means something different in the UK and Ireland (71 markets) from North America
  (411). Eleven of the 13 tours are North American; two are in mainland Europe.
- Population is still a baseline here: among the smaller markets, it ranks the bigger ones first.
