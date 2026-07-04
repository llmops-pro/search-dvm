#!/usr/bin/env node
// search-dvm — a NOSTR Data Vending Machine (NIP-90 kind 5302, Nostr Content
// Search). Listens for paid search jobs, verifies settlement on our own node,
// returns matching notes. Signs with a dedicated DVM identity (never the brand key).
import { getPublicKey, nip19, SimplePool } from "nostr-tools";
import { AuditLog } from "./audit.js";
import { loadConfig } from "./config.js";
import { announce, handleJob, JOB_REQUEST } from "./dvm.js";
import { PaymentGate } from "./payment.js";

const VERSION = "0.1.0";

function secretKeyBytes(raw: string): Uint8Array {
  if (raw.startsWith("nsec1")) return nip19.decode(raw).data as Uint8Array;
  return Uint8Array.from(Buffer.from(raw, "hex"));
}

async function main(): Promise<void> {
  const config = loadConfig();
  const sk = secretKeyBytes(config.DVM_NOSTR_PRIVATE_KEY);
  const pubkey = getPublicKey(sk);
  const pool = new SimplePool();
  const gate = new PaymentGate(config.RECEIVE_NWC_CONNECTION_STRING);
  const audit = new AuditLog(config.AUDIT_LOG_PATH);
  const deps = { config, pool, sk, pubkey, gate, audit };

  audit.record("startup", { version: VERSION, npub: nip19.npubEncode(pubkey), kind: JOB_REQUEST, price_sats: config.PRICE_SATS });
  console.error(
    `search-dvm v${VERSION} | npub ${nip19.npubEncode(pubkey)} | kind ${JOB_REQUEST} | ${config.PRICE_SATS} sats | ` +
    `listen ${config.DVM_RELAYS.length} relays | search ${config.SEARCH_RELAYS.length} relays`,
  );

  await announce(deps);

  // Subscribe to incoming job requests (since startup) and handle each.
  pool.subscribeMany(
    config.DVM_RELAYS,
    { kinds: [JOB_REQUEST], since: Math.floor(Date.now() / 1000) },
    {
      onevent: (ev) => {
        handleJob(deps, ev).catch((err) =>
          audit.record("error", { job_id: ev.id, stage: "handle", error: String(err).slice(0, 160) }),
        );
      },
    },
  );

  const shutdown = () => {
    try {
      pool.close(config.DVM_RELAYS);
      gate.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("search-dvm fatal:", err);
  process.exit(1);
});
