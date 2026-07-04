# search-dvm

A **NIP-90 Data Vending Machine** for **kind 5302 — Nostr Content Search**, with
Lightning payment **verified on the operator's own node** before results are
released. Part of the [LLMOps.Pro agent-payments kit](https://github.com/llmops-pro).

**Live:** announced via NIP-89 (kind 31990), listed on DVMDash. 50 sats/query.

## Flow

```
kind 5302 job request
  → kind 7000 status: payment-required (bolt11 invoice, minted via NWC make_invoice)
  → customer pays
  → settlement VERIFIED on our own node (NWC lookup_invoice — never the spoofable zap receipt)
  → kind 6302 job result (NIP-50 relay search, JSON of matching notes)
```

Pay-before-result. Every step is audited to NDJSON.

## Design points

- **Dedicated DVM identity** — the DVM signs with its own key, never the brand
  key. Generate one: `pnpm gen-identity`.
- **Receive-only wallet** — the NWC connection is `make_invoice` +
  `lookup_invoice` scope only. A compromised box can issue invoices, never
  spend.
- **On-node settlement verification** — the payment gate is the same primitive
  that runs our L402 search service
  ([search-service](https://github.com/llmops-pro/search-service)).

## Run it

```bash
cp .env.example .env   # fill in: DVM key (pnpm gen-identity), receive-only NWC string
pnpm install
pnpm start             # or: fly deploy (see fly.toml; secrets go in fly secrets, not the file)
```

Config is documented inline in [.env.example](./.env.example).

## License

MIT © LLMOps.Pro. Contact: [npub1hdg932…](https://njump.me/npub1hdg932jvwc3jdvkqywgqv0ue4nn60exrf92asy8mtazt3hjg7d2s2yw0nw) · ⚡ sovereigncitizens@llmops.pro
