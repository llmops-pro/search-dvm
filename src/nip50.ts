// NIP-50 search backend: query search-capable relays for kind:1 notes matching
// a text prompt, dedup by id, return the top matches as the DVM result payload.
import { SimplePool, type Event } from "nostr-tools";

export type SearchHit = { id: string; pubkey: string; created_at: number };

export async function nostrContentSearch(
  pool: SimplePool,
  relays: string[],
  query: string,
  maxResults: number,
  timeoutMs = 8000,
): Promise<SearchHit[]> {
  // NIP-50: a `search` field on the filter. Over-fetch a little, then dedup + cap.
  const filter = { kinds: [1], search: query, limit: Math.min(maxResults * 2, 100) };
  const events: Event[] = await Promise.race([
    pool.querySync(relays, filter),
    new Promise<Event[]>((resolve) => setTimeout(() => resolve([]), timeoutMs)),
  ]);

  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const e of events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    hits.push({ id: e.id, pubkey: e.pubkey, created_at: e.created_at });
    if (hits.length >= maxResults) break;
  }
  return hits;
}

/** NIP-90 kind-5302 result content: a JSON-stringified list of tags (`e` per the spec). */
export function hitsToResultContent(hits: SearchHit[]): string {
  return JSON.stringify(hits.map((h) => ["e", h.id]));
}
