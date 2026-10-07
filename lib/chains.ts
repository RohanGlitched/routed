/** National chains: a street team's poster goes in the independent shop, not the franchise. */
export const CHAINS = /\b(starbucks|panera|dunkin|peet'?s|tim hortons|costa coffee|pret|caff[eè] nero|barnes|waterstones|blue bottle|philz|caribou|greggs|mcdonald|chipotle|subway)\b/i;

/** Drops chains from a list of places (also applied when showing tours saved before the filter worked). */
export const independents = <T extends { name: string }>(spots: T[] = []): T[] => spots.filter((x) => !CHAINS.test(x.name));
