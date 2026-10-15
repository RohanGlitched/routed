import { AsyncLocalStorage } from "node:async_hooks";
import type { Usage } from "./types";

/**
 * What one tour costs, counted as it runs (Playbook L8): Qloo requests that went over the network (cache hits
 * aside), model calls and their tokens. The tour book shows the tally, so the cost of a run is on the page.
 */
const store = new AsyncLocalStorage<Usage>();

export const newUsage = (): Usage => ({ qloo: 0, qlooCached: 0, modelCalls: 0, tokensIn: 0, tokensOut: 0 });

export function withUsage<T>(u: Usage, fn: () => T): T {
  return store.run(u, fn);
}

export function countQloo(cached: boolean) {
  const u = store.getStore();
  if (!u) return;
  if (cached) u.qlooCached++;
  else u.qloo++;
}

export function countModel(usage?: { prompt_tokens?: number; completion_tokens?: number }) {
  const u = store.getStore();
  if (!u) return;
  u.modelCalls++;
  u.tokensIn += usage?.prompt_tokens ?? 0;
  u.tokensOut += usage?.completion_tokens ?? 0;
}
