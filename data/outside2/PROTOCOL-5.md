# Outside tests, round 5: club and theatre acts only

Protocol committed before scoring, from offline caches. This file goes into its own commit before the subset is
scored. The script (`scripts/indie-subset.ts`), the two rules it uses (`medianCapacity` and `isClubAndTheatre` in
`lib/headtohead.ts`, with tests in `test/headtohead.test.ts`) and the result (`indie-subset.json`, `RESULTS.md`)
follow in a later commit, published whatever they say.

## Why

Routed is pitched at acts who play rooms of 500 to 3,000 and route without a data team. The city tests so far are
mostly arena and stadium tours: of the 49 older tours, 30 were drawn from Wikipedia's tour categories, and the 13
tours announced after the model's release include Garth Brooks, Karol G, Take That and the Jonas Brothers. A judge
asked the fair question: does Qloo's ranking still help on the tours of the acts Routed is for? This test keeps only
the tours whose real rooms held 3,000 or fewer and compares the same rankings the same way.

## What is already known, stated up front

- Every tour here is already scored as a whole tour, artist by artist: `data/head-to-head/results.json`
  (`test1Rows`, 49 tours) and `data/outside2/results.json` (`postcut.rows`, 13 tours). So this is a second look at
  published data, not new tours. It is "committed before scoring" only in the sense that no score for this subset
  had been computed when this file was committed.
- Before writing this file, the only thing computed was each tour's room size and so who is in the subset
  (`npx tsx scripts/indie-subset.ts members`). That uses only the real tours' venues and the stated crowds, no
  method's answer. The list is below.

## The rule: a tour's room size

For each of the 62 tours, the first of these that exists:

1. **Measured, older tours.** `data/outside2/venues-truth.json` `draw`: the median Wikidata maximum capacity (P1083)
   of the real tour's linked venues in its scored rows, rounded to 100, as the venue test set it (`scripts/outside2.ts`
   truth, at least 2 venues measured). This covers the 30 held-out tours and the 4 benchmark tours with a Wikipedia
   article.
2. **Measured, post-cutoff tours.** The same median, from the article text cached when the tours were sampled
   (`.probe/outside2/pc-wiki`) and read by `lib/wikitours.ts` showRows: rows in the tour's region whose city is one
   of its scored markets, each venue name matched to a Wikidata item cached by the venue test
   (`.probe/outside2/pageprops` titles and redirects, `.probe/outside2/wikidata` labels and aliases; a name that
   points at two items is not used). At least 2 venues must be measured. A venue not in the cache stays unmeasured;
   nothing is looked up.
3. **Stated.** For the 15 benchmark tours that have no Wikipedia article (press listings only, so no venue table):
   the usual crowd fixed for each artist in `scripts/bench.mjs` on Oct 8, before any of these tests.
4. Otherwise the size is unknown and the tour is left out.

**The subset:** a known size of 3,000 or fewer (`isClubAndTheatre`, `CLUB_THEATRE_MAX = 3000`).

## Who is in it (computed from sizes only, before scoring)

20 tours:
- **Older tours, measured (6):** Japanese Breakfast 2,800, Chappell Roan 1,600, Queens of the Stone Age 2,800,
  Flo 2,300, Gary Barlow 2,400, Ledisi 2,700.
- **Older tours, stated (13):** Caamp 2,500, Waxahatchee 1,500, Khruangbin 3,000, Durand Jones & The Indications
  1,200, Knocked Loose 2,500, Cuco 2,500, MJ Lenderman 900, Parcels 2,000, Alvvays 1,500, Arlo Parks 1,500,
  Wet Leg 2,000, Fontaines D.C. 3,000, JPEGMAFIA 1,500.
- **Post-cutoff, measured (1):** Flo 2,200 (a different tour from her older one; both count, as tours).

Out: 40 tours over 3,000, and 2 post-cutoff tours with no size (Take That: 0 venues in the cache; Sugarland: 1).

## Rankings and metric

The five rankings and their per-tour hits exactly as published: population (P), the model alone (M), Qloo's heatmap
ranking (Q), the Qloo + population blend Routed ships (Q+P), and the model + Qloo blend (M+Q). R-precision against
the real tour's markets in its region: of a ranking's top R, how many the tour played, R being the tour's number of
markets.

## Contrasts

- **Primary**, on all 20 tours:
  - Q+P vs P. Does the shipped blend beat city size for club and theatre acts?
  - Q+P vs M. Is the shipped blend level with the model for them?
- **Secondary**, on all 20: Q vs M; Q vs P; M vs P; M+Q vs M.
- **Also reported:** the same contrasts on the older tours alone (19), on the post-cutoff tour alone (1, shown only
  as a count), on the measured-size tours alone (7, a sensitivity check), and on the 40 tours over 3,000 for
  comparison; pooled hits over picks for each ranking.

## Statistics

As in rounds 1 to 3 (`lib/headtohead.ts`): per-tour paired differences; wins, losses and ties; an exact two-sided
sign test; the mean difference with a 95% percentile bootstrap interval (10,000 resamples). Seeds: 20261018 for the
older tours alone (the head-to-head's seed), 20261025 for every other group (round 2's seed).

## Budget

0 Qloo requests, 0 model calls, 0 network calls. `fetch` is replaced by a function that throws, and the script
checks that it was never called.

## Limits

- 13 of the 20 sizes are stated, not measured. In the 4 benchmark tours that have both, the stated crowd was below
  the measured median every time (Japanese Breakfast 1,500 against 2,800; Clairo 3,000 against 3,500; Turnstile
  2,500 against 7,000; Ghost 8,000 against 13,500). So some stated members may have played bigger rooms. The
  measured-only group (7 tours) is the check on that.
- Only 1 of the 13 post-cutoff tours qualifies, so the subset is almost all older tours, which the model may have
  read about. Q+P vs M here carries that memory caveat.
- The post-cutoff sizes come only from rooms the venue test happened to cache, mostly arenas and big theatres, so they
  lean large. That can only keep a tour out of the subset, never put one in.
- 20 pairs is a small sample. With no ties, the sign test needs at least 15–5 to reach p < 0.05.
- A tour's room size is a median: an act that played clubs and a few arenas can land either side of 3,000.
