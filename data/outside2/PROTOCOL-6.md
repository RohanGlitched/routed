# Outside tests, round 6: the street level

Protocol committed before scoring, from offline caches. This file goes into its own commit before anything is
scored. The script (`scripts/street-level.ts`), its helpers (`lowerMedian`, `streetSpot`, `tileReachKm` and
`shareFarther` in `lib/headtohead.ts`, with tests in `test/headtohead.test.ts`) and the result
(`street-level.json`, `RESULTS.md`, a short section on /proof) follow in a later commit, published whatever they say.

## Why

Routed's headline unique value is now the street layer: inside each city, Qloo's heatmap (geohash-7 tiles, about
150 m across) says where an artist's fans over-index, and the day sheet books a room near the hottest tile. Every
test so far checks cities or rooms; none checks that layer against anything outside Qloo. This one asks: are the
rooms artists really played nearer the hottest tile of their street heatmap than the city's other rooms, or than
the city centre?

## What is already known, stated up front

- The only street heatmaps on disk are the ones stored with the tours (`.data/tours/<id>.json`,
  `plan.stops[].local.tiles`: the city's 160 strongest tiles, strength = affinity x popularity stretched to 0-1,
  kept out of git). The room test (round 4) cached each city's candidate rooms but no heatmap. So the overlap is
  the poster wall's artists only.
- Before writing this file, the only thing computed was which real rooms can be placed on a cached heatmap
  (`npx tsx scripts/street-level.ts members`). That uses names and coordinates only, no distance to any tile.
  The list is below.

## The cases

- **Heatmaps.** The poster wall's 8 tours as they stand on Oct 30 (8v4ce57nx6, ipgunjvpgt, fx3xht5bex,
  at2uxhew2q, 3nuqugrj3n, xf4rbjj9s9, xzm49sq9qt, jrp8bq4md8), then, for cities the wall lacks, the newest other
  stored tour of the same artist. One heatmap per artist and city.
- **Real rooms**, from committed or cached sources only: `data/outside2/venues-truth.json` (the venue test's
  cities); the tour articles already cached (`.probe/outside2/wiki`, `.probe/outside2/pc-wiki`, `.probe/h2h/wiki`,
  read by `lib/wikitours.ts` showRows) whose infobox artist is the artist; `data/real-tours.json` notes of the form
  "City = Venue"; and `data/flagship-reality.json` (Sierra Ferrell's 2026 headline rooms). One row per artist, city
  and room.
- **Where the real room is:** a candidate room of the same name in a stored tour stop or the room test's cache
  (`.probe/outside2/rooms4/city`), else the cached Wikidata item's coordinates (P625, `.probe/outside2/wikidata`;
  a name on two items is not used). Nothing is looked up.
- **In the test** when the room is placed, lies no farther from the city centre than the heatmap's farthest kept
  tile, and the stop has at least 3 other candidate rooms (rooms more than 0.2 km from the real one, other names).

**Who is in it (computed from names and coordinates only, before scoring): 9 of 18 real rooms.**

- In (9): Japanese Breakfast at the Metropolitan Opera House (Philadelphia), the Moody Theater (Austin), The Salt
  Shed (Chicago), the SF Masonic Auditorium (San Francisco) and the Mission Ballroom (Denver); Turnstile at the Bill
  Graham Civic Auditorium (San Francisco) and the Mann Center (Philadelphia); Sierra Ferrell at McMenamins Edgefield
  (Portland area) and Stage AE (Pittsburgh).
- Out (9): 8 rooms with no cached coordinates (Japanese Breakfast: Brooklyn Paramount, Project Pabst, Woodland Park
  Zoo; Turnstile: The Stage at Suffolk Downs, Huntington Bank Pavilion, Project 70, Exposition Park South Lawn; Zach
  Bryan: H.A. Chapman Stadium) and 1 beyond the heatmap's reach (Japanese Breakfast, Orpheum Theatre, Vancouver).
- Wall artists with no real room in a heatmap city: Fontaines D.C., Khruangbin, MJ Lenderman, Alvvays.

## Measures

For each case, on that artist's heatmap for that city (`lib/geo/local.ts`, the day sheet's own rules):

- **km to the hottest tile** for the real room, for each other candidate room, and for the city centre (the
  market's coordinates);
- **tile strength**: the strongest kept tile within 0.35 km (placeHeat's rule; 0 when none is that close);
- **share farther**: the share of the other candidate rooms farther from the hottest tile than the real room, ties
  half (0.5 is what a room picked at random scores).

## Contrasts

- **Primary:** km to the hottest tile, the real room against the lower median of the city's other candidate rooms.
  A win is a real room nearer the hottest tile.
- **Secondary:** the real room against the city centre (km to the hottest tile); tile strength, the real room
  against the other rooms' lower median.
- **Also reported:** the mean share farther, and how many real rooms fall in the fans' area as the day sheet
  defines it (within 1.5 km of the hottest tile, or on a tile of strength 0.9 or more).

## Statistics

As in rounds 1 to 5 (`lib/headtohead.ts`): per-case paired differences; wins, losses and ties; an exact two-sided
sign test; the mean difference with a 95% percentile bootstrap interval (10,000 resamples, seed 20261025).

**Too small to settle it:** with fewer than 10 cases the result is published as a pilot, not as a test of the
claim. With 9 cases and no ties, only 8-1 or 9-0 reaches p < 0.05. The script then sizes the larger run below for
the owner to approve; it is not run.

## The larger run, sized (needs the owner's OK; not run)

The room test's 34 artists x 3 cities (102 cities) already have the real room (`venues-truth.json`) and the city's
candidate rooms (round 4's cache). The missing piece is each artist's street heatmap for each city: 1 Qloo request
per artist and city, so 102 requests. From today's caches, 53 of the 102 can place the real room and have 3 or more
other rooms; reading the rest of the rooms' coordinates from Wikidata costs no Qloo request. That is a test of about
53 to 100 cases for about 102 Qloo requests and 0 model calls.

## Budget

0 Qloo requests, 0 model calls, 0 network calls. `fetch` is replaced by a function that throws, and the script
checks that it was never called. The output keeps derived distances, strengths and counts only: no tiles, no
coordinates, no raw Qloo response.

## Limits

- 9 cases from 3 artists; Japanese Breakfast is 5 of them. It is a pilot.
- The candidate rooms are Qloo's own places for that artist, so "nearer than the other rooms" is a hard bar: those
  rooms were already picked for the artist.
- Some real rooms are outdoor or suburban (Edgefield is in Troutdale; Stage AE Outdoors is a lawn). They are kept by the
  reach rule above; the city centre comparison shows how much that matters.
- The heatmaps were read in October 2026; the real shows were played in 2025 and 2026. Fans move slowly, but they
  do move.
