// Generate a DEDICATED DVM Nostr identity. This key signs DVM events on a
// cloud box — it must NOT be the brand key (bb5058aa…). Print hex + npub;
// the operator stores the hex in DVM_NOSTR_PRIVATE_KEY.
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";

const sk = generateSecretKey();
const skHex = Buffer.from(sk).toString("hex");
const pk = getPublicKey(sk);
console.log("DVM identity generated (store the hex in DVM_NOSTR_PRIVATE_KEY, keep it safe):\n");
console.log("  private key (hex):", skHex);
console.log("  public key (hex): ", pk);
console.log("  npub:             ", nip19.npubEncode(pk));
console.log("\nThis is a SERVICE identity, separate from the brand npub. It only signs job");
console.log("responses; the receive wallet is receive-only; the brand key stays off the box.");
