// Keeps one job subscription alive per relay, for the life of the process.
//
// Why (2026-10-17): the DVM used to subscribe once at startup. When the relay
// connections dropped, nothing else kept Node's event loop busy, so the process
// ran out of work and exited with code 0. Fly doesn't restart a machine that
// exits cleanly, so the DVM stayed down from 2026-06-15 until noticed.
//
// Each relay gets its own subscription. When it closes (or the pool reports
// the relay disconnected), we resubscribe with backoff: 1 s doubling to 30 s,
// back to 1 s once a subscription has stayed up for a minute. Resubscribing
// asks for events from shortly before the newest one seen, so nothing is
// missed during the gap; duplicates are dropped by handleJob's own `handled` set.
// The watchdog interval also keeps the process alive.
import type { Event, Filter, SimplePool } from "nostr-tools";
import { normalizeURL } from "nostr-tools/utils";

const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const STABLE_AFTER_MS = 60_000;
const WATCHDOG_MS = 30_000;
const RESUBSCRIBE_OVERLAP_SEC = 120;

type Options = {
  pool: SimplePool;
  relays: string[];
  /** Filter for the subscription; `since` is filled in by the supervisor. */
  filter: Omit<Filter, "since">;
  onevent: (ev: Event) => void;
  log: (event: "relay_resubscribe", data: Record<string, unknown>) => void;
};

type RelayState = {
  url: string;
  closer: { close: () => void } | null;
  generation: number;
  startedAt: number;
  backoffMs: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
};

export function superviseSubscriptions(opts: Options): { stop: () => void } {
  const startedAtSec = Math.floor(Date.now() / 1000);
  let newestSeen = 0; // created_at of the newest event received, any relay
  let stopped = false;

  const states = opts.relays.map<RelayState>((url) => ({
    url: normalizeURL(url),
    closer: null,
    generation: 0,
    startedAt: 0,
    backoffMs: BACKOFF_MIN_MS,
    retryTimer: null,
  }));

  function since(): number {
    return newestSeen > 0 ? newestSeen - RESUBSCRIBE_OVERLAP_SEC : startedAtSec;
  }

  function subscribe(s: RelayState): void {
    if (stopped) return;
    const gen = ++s.generation;
    s.startedAt = Date.now();
    s.closer = opts.pool.subscribeMany([s.url], { ...opts.filter, since: since() } as Filter, {
      onevent: (ev) => {
        if (ev.created_at > newestSeen) newestSeen = ev.created_at;
        opts.onevent(ev);
      },
      onclose: (reasons) => {
        if (gen !== s.generation) return; // an older subscription we already replaced
        scheduleRetry(s, reasons.join("; ") || "closed");
      },
    });
  }

  function scheduleRetry(s: RelayState, reason: string): void {
    if (stopped || s.retryTimer) return;
    s.generation++; // ignore any late callbacks from the old subscription
    try {
      s.closer?.close();
    } catch {
      // already closed
    }
    s.closer = null;
    if (Date.now() - s.startedAt >= STABLE_AFTER_MS) s.backoffMs = BACKOFF_MIN_MS;
    const delay = s.backoffMs;
    s.backoffMs = Math.min(s.backoffMs * 2, BACKOFF_MAX_MS);
    opts.log("relay_resubscribe", { relay: s.url, reason: reason.slice(0, 120), delay_ms: delay });
    s.retryTimer = setTimeout(() => {
      s.retryTimer = null;
      subscribe(s);
    }, delay);
  }

  // The pool removes a relay from its map when the socket closes, so a relay
  // missing from the map (or marked not connected) while we think we're
  // subscribed means the subscription is dead. Give a fresh subscription a
  // few seconds to connect before judging it.
  const watchdog = setInterval(() => {
    const status = opts.pool.listConnectionStatus();
    for (const s of states) {
      if (s.retryTimer || !s.closer) continue;
      if (Date.now() - s.startedAt < 15_000) continue;
      if (status.get(s.url) !== true) scheduleRetry(s, "watchdog: relay not connected");
    }
  }, WATCHDOG_MS);

  for (const s of states) subscribe(s);

  return {
    stop() {
      stopped = true;
      clearInterval(watchdog);
      for (const s of states) {
        if (s.retryTimer) clearTimeout(s.retryTimer);
        try {
          s.closer?.close();
        } catch {
          // already closed
        }
      }
    },
  };
}
