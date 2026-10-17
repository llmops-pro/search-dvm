// NIP-90 Data Vending Machine — kind 5302 (Nostr Content Search).
// Flow: 5302 job request → 7000 payment-required (bolt11) → verify on our node
// → 6302 result. Pay-before-result. Signs with a dedicated DVM identity.
import { finalizeEvent, type Event, type EventTemplate, type SimplePool } from "nostr-tools";
import type { AuditLog } from "./audit.js";
import type { Config } from "./config.js";
import { hitsToResultContent, nostrContentSearch } from "./nip50.js";
import type { PaymentGate } from "./payment.js";

export const JOB_REQUEST = 5302; // Nostr Content Search
export const JOB_RESULT = 6302; // = request + 1000
export const JOB_FEEDBACK = 7000;
export const HANDLER_ANNOUNCE = 31990; // NIP-89

type Deps = {
  config: Config;
  pool: SimplePool;
  sk: Uint8Array;
  pubkey: string;
  gate: PaymentGate;
  audit: AuditLog;
};

function now(): number {
  return Math.floor(Date.now() / 1000);
}

async function publish(pool: SimplePool, relays: string[], ev: Event): Promise<number> {
  const results = await Promise.allSettled(pool.publish(relays, ev));
  return results.filter((r) => r.status === "fulfilled").length;
}

function sign(sk: Uint8Array, tmpl: EventTemplate): Event {
  return finalizeEvent(tmpl, sk);
}

/** One-time kind-31990 announcement so clients can discover this DVM (NIP-89). */
export async function announce(d: Deps): Promise<void> {
  const ev = sign(d.sk, {
    kind: HANDLER_ANNOUNCE,
    created_at: now(),
    tags: [
      ["d", "search-dvm-5302"],
      ["k", String(JOB_REQUEST)],
      ["t", "search"],
      ["t", "nostr"],
    ],
    content: JSON.stringify({
      name: "Sovereign Citizens — Nostr Content Search",
      about: `Pay-per-search of Nostr notes. ${d.config.PRICE_SATS} sats/query, settlement verified on our own node. No account. Part of the open LLMOps.Pro agent-payments kit.`,
    }),
  });
  const ok = await publish(d.pool, d.config.DVM_RELAYS, ev);
  d.audit.record("announce", { event_id: ev.id, relays_ok: ok });
}

function extractQuery(job: Event): string | null {
  // NIP-90 input: ["i", <value>, "text", ...]. Fall back to content.
  for (const t of job.tags) {
    if (t[0] === "i" && typeof t[1] === "string" && t[1].trim()) return t[1].trim();
  }
  return job.content.trim() || null;
}

function relayHint(config: Config): string {
  return config.DVM_RELAYS[0] ?? "";
}

const handled = new Set<string>(); // job-request ids we've already started

/** Handle one incoming kind-5302 job request end to end. */
export async function handleJob(d: Deps, job: Event): Promise<void> {
  if (handled.has(job.id)) return; // a relay re-delivered it
  handled.add(job.id);

  // NIP-90: a job with "p" tags is meant only for those providers. Answer
  // untargeted jobs and jobs addressed to us; ignore jobs for other DVMs
  // (otherwise their requesters get an invoice they never asked for). Seen
  // 2026-10-17: ~250 kind-5302 jobs/month, all addressed to two other DVMs.
  const targets = job.tags.flatMap((t) => (t[0] === "p" && t[1] ? [t[1]] : []));
  if (targets.length > 0 && !targets.includes(d.pubkey)) {
    d.audit.record("ignored_other_provider", { job_id: job.id, from: job.pubkey, targets: targets.map((t) => t.slice(0, 12)) });
    return;
  }

  const query = extractQuery(job);
  d.audit.record("job_received", { job_id: job.id, from: job.pubkey, has_query: Boolean(query) });
  if (!query) {
    await publish(d.pool, d.config.DVM_RELAYS, sign(d.sk, {
      kind: JOB_FEEDBACK,
      created_at: now(),
      tags: [["status", "error"], ["e", job.id, relayHint(d.config)], ["p", job.pubkey]],
      content: "No search input provided (expected an 'i' tag of type text).",
    }));
    d.audit.record("no_input", { job_id: job.id });
    return;
  }

  // Mint invoice, request payment.
  let minted;
  try {
    minted = await d.gate.mint(d.config.PRICE_SATS, `nostr content search: "${query.slice(0, 64)}"`);
  } catch (err) {
    d.audit.record("error", { job_id: job.id, stage: "mint", error: String(err).slice(0, 160) });
    return;
  }
  await publish(d.pool, d.config.DVM_RELAYS, sign(d.sk, {
    kind: JOB_FEEDBACK,
    created_at: now(),
    tags: [
      ["status", "payment-required"],
      ["e", job.id, relayHint(d.config)],
      ["p", job.pubkey],
      ["amount", String(minted.amount_msat), minted.invoice],
    ],
    content: "",
  }));
  d.audit.record("payment_required", { job_id: job.id, payment_hash: minted.payment_hash, amount_sats: d.config.PRICE_SATS });

  // Poll for settlement up to the TTL.
  const deadline = Date.now() + d.config.INVOICE_TTL_SECONDS * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    if (await d.gate.isSettled(minted.payment_hash)) break;
  }
  if (!(await d.gate.isSettled(minted.payment_hash))) {
    d.audit.record("payment_timeout", { job_id: job.id, payment_hash: minted.payment_hash });
    return;
  }
  if (d.gate.alreadyFulfilled(minted.payment_hash)) return;
  d.gate.markFulfilled(minted.payment_hash);
  d.audit.record("settled", { job_id: job.id, payment_hash: minted.payment_hash });

  // Run the search and deliver the result.
  try {
    const hits = await nostrContentSearch(d.pool, d.config.SEARCH_RELAYS, query, d.config.MAX_RESULTS);
    const result = sign(d.sk, {
      kind: JOB_RESULT,
      created_at: now(),
      tags: [
        ["request", JSON.stringify(job)],
        ["e", job.id, relayHint(d.config)],
        ["p", job.pubkey],
        ["i", query, "text"],
        ["amount", String(minted.amount_msat), minted.invoice],
      ],
      content: hitsToResultContent(hits),
    });
    const ok = await publish(d.pool, d.config.DVM_RELAYS, result);
    await publish(d.pool, d.config.DVM_RELAYS, sign(d.sk, {
      kind: JOB_FEEDBACK,
      created_at: now(),
      tags: [["status", "success"], ["e", job.id, relayHint(d.config)], ["p", job.pubkey]],
      content: "",
    }));
    d.audit.record("result_published", { job_id: job.id, result_id: result.id, results: hits.length, relays_ok: ok });
  } catch (err) {
    await publish(d.pool, d.config.DVM_RELAYS, sign(d.sk, {
      kind: JOB_FEEDBACK,
      created_at: now(),
      tags: [["status", "error"], ["e", job.id, relayHint(d.config)], ["p", job.pubkey]],
      content: "Search backend failed after payment — contact the operator with the payment hash for a refund.",
    }));
    d.audit.record("error", { job_id: job.id, stage: "search", payment_hash: minted.payment_hash, error: String(err).slice(0, 160) });
  }
}
