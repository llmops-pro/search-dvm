// NWC payment gate — mint a bolt11 invoice, verify settlement on our own node.
// Same primitives as the search-service HTTP gate; receive-only connection.
import { nwc } from "@getalby/sdk";

export type Minted = { invoice: string; payment_hash: string; amount_msat: number };

export class PaymentGate {
  private client: nwc.NWCClient;
  // payment_hashes already delivered — never deliver twice.
  private fulfilled = new Set<string>();

  constructor(connectionString: string) {
    this.client = new nwc.NWCClient({ nostrWalletConnectUrl: connectionString });
  }

  async mint(amountSats: number, memo: string): Promise<Minted> {
    const res = await this.client.makeInvoice({ amount: amountSats * 1000, description: memo });
    return { invoice: res.invoice, payment_hash: res.payment_hash, amount_msat: amountSats * 1000 };
  }

  async isSettled(paymentHash: string): Promise<boolean> {
    try {
      const inv = await this.client.lookupInvoice({ payment_hash: paymentHash });
      return Boolean(inv.settled_at);
    } catch {
      return false;
    }
  }

  alreadyFulfilled(paymentHash: string): boolean {
    return this.fulfilled.has(paymentHash);
  }

  markFulfilled(paymentHash: string): void {
    this.fulfilled.add(paymentHash);
  }

  close(): void {
    this.client.close?.();
  }
}
