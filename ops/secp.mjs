// Key handling delegated to `cast`, which is already required for deployment.
//
// ponytail: shelling out beats vendoring a secp256k1 implementation for three calls.
// If ops ever needs this in a browser or a hot loop, swap in @noble/secp256k1.

import { execFileSync } from "node:child_process";
import { CAST } from "./env.mjs";

const run = (args) => execFileSync(CAST, args, { encoding: "utf8" }).trim();

export const secp256k1 = {
  newPrivateKey() {
    // `cast wallet new` prints "Address: 0x…" and "Private key: 0x…".
    const out = run(["wallet", "new"]);
    return /Private key:\s*(0x[0-9a-fA-F]{64})/.exec(out)[1];
  },

  addressFromPrivateKey(priv) {
    return run(["wallet", "address", "--private-key", priv]);
  },

  /// EIP-191 personal_sign. Cleanverse verifies `chain + address`, both lowercase,
  /// against the pool's Ownable.owner().
  personalSign(priv, message) {
    return run(["wallet", "sign", "--private-key", priv, message]);
  },
};
