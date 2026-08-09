// Cleanverse Cooperate API client (v5.6).
//
// Two body formats: plain JSON for reads, AES-256-CBC ciphertext for writes.
// The AES key is the base64-decoded api-key and never leaves this process —
// only the api-id goes on the wire.
//
//   AES/CBC/PKCS5Padding, IV = 16 zero bytes, body = {"data": "<base64>"}
//
// Verified against the sandbox on 2026-08-02.

import crypto from "node:crypto";
import { randomUUID } from "node:crypto";

const SANDBOX = "https://uatapi.cleanverse.com/api/cooperate";
const PROD = "https://api.cleanverse.com/api/cooperate";

/** The endpoints that require an encrypted body — the docs give this as an allowlist of
 *  twenty, and everything else takes plain JSON.
 *
 *  This was originally written the other way round, as a list of plain endpoints with
 *  encryption as the default, and that is a dangerous inversion: sending an encrypted body
 *  to an endpoint that expects plain does NOT error. The gateway answers `0000` and
 *  ignores the body entirely, falling back to defaults — so a filtered query silently
 *  becomes an unfiltered one. `query_deposit_atoken_list` returned every token on every
 *  chain instead of one chain's, and a measurement was built on the result before anyone
 *  noticed. An allowlist of encrypted paths fails the safe way: a new endpoint defaults to
 *  plain, and a plain endpoint that should be encrypted returns a loud 403. */
const ENCRYPTED = new Set([
  "generate_apass", "update_status",
  "atoken/launch", "atoken/register_atoken",
  "atoken/launch_wrapped_atoken", "atoken/register_wrapped_atoken",
  "atoken/add_rule", "atoken/remove_rule", "atoken/set_paused",
  "atoken/add_whitelist_for_institutional",
  "atoken/remove_whitelist_for_institutional",
  "atoken/restore_whitelist_for_institutional",
  "blacklist/add",
  "validator/grant", "validator/register",
  "validator/set_rule", "validator/add_rule", "validator/remove_rule",
  "validator/set_paused",
]);

export class Cleanverse {
  #key;
  constructor({ apiId, apiKey, base = SANDBOX } = {}) {
    this.apiId = apiId ?? process.env.CV_API_ID;
    this.base = base;
    const raw = apiKey ?? process.env.CV_API_KEY;
    if (!this.apiId) throw new Error("missing api-id (CV_API_ID)");
    if (!raw) throw new Error("missing api-key (CV_API_KEY)");
    this.#key = Buffer.from(raw, "base64");
    if (![16, 24, 32].includes(this.#key.length)) {
      throw new Error(`api-key decodes to ${this.#key.length} bytes; expected 16/24/32`);
    }
  }

  #encrypt(obj) {
    const c = crypto.createCipheriv(`aes-${this.#key.length * 8}-cbc`, this.#key, Buffer.alloc(16, 0));
    return Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]).toString("base64");
  }

  /** POST to `path`. Encryption is chosen by the endpoint, not by the caller. */
  async post(path, payload = {}) {
    const encrypted = ENCRYPTED.has(path);
    const res = await fetch(`${this.base}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-id": this.apiId,
        "X-Request-ID": randomUUID(),
      },
      body: JSON.stringify(encrypted ? { data: this.#encrypt(payload) } : payload),
    });
    const text = await res.text();
    let body;
    // A transport failure carries no business code, so checking the code first turned
    // every 500 into "[undefined] undefined" and hid which field the server rejected.
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
    try { body = JSON.parse(text); }
    catch { throw new Error(`${path}: HTTP ${res.status}, non-JSON body: ${text.slice(0, 200)}`); }
    // HTTP 200 with a non-zero code is a business failure, not a transport failure.
    if (body.code !== "0000") {
      const err = new Error(`${path}: [${body.code}] ${body.message}`);
      err.code = body.code;
      err.body = body;
      throw err;
    }
    return body.data;
  }

  async get(path, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${this.base}/${path}${qs ? `?${qs}` : ""}`, {
      headers: { "api-id": this.apiId, "X-Request-ID": randomUUID() },
    });
    const body = await res.json();
    if (body.code !== "0000") throw new Error(`${path}: [${body.code}] ${body.message}`);
    return body.data;
  }

  // ---- A-Pass (CVI) ----------------------------------------------------

  /** Flat record only: tier, subTier, group, subGroup, status, expirationTime,
   *  currentKycHash, countries[]. Deposit addresses live in queryDepositAddress. */
  queryApass(chain, address) { return this.post("query_apass", { chain, address }); }

  queryApassList(params) { return this.post("query_apass_list", params); }

  queryDepositAddress(chain, address) { return this.post("query_deposit_address", { chain, address }); }

  /** The token-level gate: may `address` receive or transfer `atoken` under the rules the
   *  A-Token itself carries? That is a different question from `validator/verify`, which
   *  asks about a pool's rules — different contract, different rule set.
   *
   *  The four documented outcomes do not all arrive by the same route. 1 (A-Token not
   *  found), 2 (no A-Pass) and 4 (allowed) come back as HTTP 200 / code 0000 with the
   *  verdict in `data.code`. A frozen or expired A-Pass — documented as 3 — does NOT: the
   *  gateway answers code 0002 and puts the on-chain custom error in `message`, so a
   *  client that only reads `data.code` throws where it should have returned a verdict.
   *  Verified against the sandbox on 2026-08-09. This normalises all four into the
   *  documented shape, and still throws for failures that are not verdicts. */
  async verifyApass(chain, atoken, address) {
    // A malformed address comes back as verdict 2, "apass not exist" — which reads as a
    // compliance refusal about a wallet that was never asked about. Refuse it here.
    if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) {
      throw new Error(`verify_apass: ${address} is not a 20-byte address`);
    }
    try {
      return await this.post("verify_apass", { chain, atoken, address });
    } catch (e) {
      const code = apassVerdictCode(e.body?.message ?? e.message);
      if (code === null) throw e;
      return { chain, atoken, address, code, message: e.body?.message ?? e.message };
    }
  }

  /** status 1 = Activate, 2 = Freeze. */
  static isActive(rec) {
    return rec?.status === 1 && Number(rec.expirationTime) * 1000 > Date.now();
  }

  // ---- Validator (on-chain compliance pool) -----------------------------
  // Live on `base` and `polygon` only, as of 2026-08-02. Other chains return 12027.

  isRegistered(chain, contract_address) {
    return this.post("validator/is_register", { chain, contract_address });
  }

  rules(chain, contract_address) {
    return this.post("validator/rules", { chain, contract_address });
  }

  /** HTTP 200 + code 0000 means the check ran; `valid` is the outcome. */
  verify(chain, contract_address, user_address) {
    return this.post("validator/verify", { chain, contract_address, user_address });
  }

  isPaused(chain, contract_address) {
    return this.post("validator/is_paused", { chain, contract_address });
  }

  /** Grants REGISTER_ROLE. owner_signature is EIP-191 over chain + address, both lowercase. */
  grant(chain, address, owner_signature) {
    return this.post("validator/grant", { chain, address, owner_signature });
  }

  /** Registers our pool and sets its first rule. Pool must expose Ownable.owner(). */
  register(chain, contract_address, rule, owner_signature) {
    return this.post("validator/register", { chain, contract_address, rule, owner_signature });
  }

  setRule(chain, contract_address, rule) {
    return this.post("validator/set_rule", { chain, contract_address, rule });
  }

  addRule(chain, contract_address, rule) {
    return this.post("validator/add_rule", { chain, contract_address, rule });
  }

  removeRule(chain, contract_address, index) {
    return this.post("validator/remove_rule", { chain, contract_address, index });
  }

  setPaused(chain, contract_address, paused) {
    return this.post("validator/set_paused", { chain, contract_address, paused });
  }

  // ---- A-Token (CVA) ---------------------------------------------------

  /** Issuance. This is the "from the issuance stage" hook Track 1 requires. */
  launchAtoken(params) { return this.post("atoken/launch", params); }

  launchWrappedAtoken(params) { return this.post("atoken/launch_wrapped_atoken", params); }

  // atoken_address, not contract_address. The validator endpoints take the latter, these
  // take the former, and the wrong name returns HTTP 500 — invisible until post() started
  // reporting the status, because a 500 body carries no `code`.
  atokenRules(chain, atoken_address) { return this.post("atoken/rules", { chain, atoken_address }); }

  /** The A-Token's posture, and the ONLY safe way to read its rules.
   *
   *  atoken/rules answers `0000` with `rules: []` for any address at all — a mistyped
   *  A-Token, a wrong chain, a token whose issuance failed. It cannot distinguish "this
   *  asset carries no rules" from "there is no such asset", and the caller that reads the
   *  empty array prints the most permissive compliance claim available: this asset admits
   *  everyone. A missing token rendered as an open door.
   *
   *  atoken/is_paused CAN tell the difference — it returns 12017 for an address with no
   *  ISSUED application row — so existence is proved first and the rule set is only
   *  reported about a token that demonstrably exists. */
  async atokenPosture(chain, atoken_address) {
    const { paused } = await this.atokenIsPaused(chain, atoken_address);
    const { rules = [] } = await this.atokenRules(chain, atoken_address);
    return { paused, rules };
  }

  addAtokenRule(chain, atoken_address, rule) {
    return this.post("atoken/add_rule", { chain, atoken_address, rule });
  }

  atokenIsPaused(chain, atoken_address) {
    return this.post("atoken/is_paused", { chain, atoken_address });
  }

  /** WRITE. Halts every transfer of the A-Token. Nothing in the repo calls this — it is
   *  here so the kill switch is one call away, not so it runs. `ops/cva-gate.mjs` keeps
   *  it behind an explicit flag. */
  setAtokenPaused(chain, atoken_address, paused) {
    return this.post("atoken/set_paused", { chain, atoken_address, paused });
  }

  applyStatus(requestId) { return this.get(`atoken/query_apply_status/${requestId}`); }

  // ---- Indexed transaction history -------------------------------------

  /** `symbol` is documented optional and is not: omitting it, or passing a symbol the
   *  indexer does not know, returns `[0002] invalid symbol`. Only Cleanverse's own
   *  catalogue is indexed (`ausdc`, `usdc`, …) — a self-issued A-Token's symbol is
   *  rejected, so this cannot see SAKSIAZEV transfers. Verified 2026-08-09. */
  queryTxs(params) { return this.post("query_txs", params); }

  /** Deposits/withdrawals between a licensed institution and a user. `type` is required
   *  and is "deposit" or "withdraw". Returns null data when the caller is not the
   *  institution on record. */
  queryInstitutionTxs(params) { return this.post("query_institution_txs", params); }

  listMyAtokens(params = {}) { return this.get("atoken/list_my_atokens", params); }

  // ---- Compliance evidence --------------------------------------------

  blacklistAdd(params) { return this.post("blacklist/add", params); }

  /** Returns { downloadUrl, fileName } for a real Travel Rule PDF. */
  downloadTravelRule(params) { return this.post("download_travel_rule", params); }
}

/** The verdict codes `verify_apass` returns in `data.code`. */
export const APASS_VERDICT = {
  1: "A-Token not found",
  2: "no A-Pass",
  3: "A-Pass frozen or expired",
  4: "allowed",
};

/** Recover the documented verdict from a gateway error message, for the outcomes the
 *  gateway reports as a 0002 instead of a `data.code`. Returns null when the message is
 *  not a verdict at all — a genuine failure must stay a failure. */
export function apassVerdictCode(message = "") {
  if (/APassNotActive/i.test(message)) return 3;
  if (/apass not (exist|found)|APassNotExist/i.test(message)) return 2;
  if (/atoken not exist/i.test(message)) return 1;
  return null;
}

/**
 * Build the compliance rule object shared by validator/* and atoken/*.
 * `countries` is an allow-list unless isBlackList is true.
 */
export function rule({
  allowedGroup = "", allowedSubGroup = "", minTier = 0, minSubTier = 0,
  isBlackList = false, countries = [],
} = {}) {
  return {
    allowed_group: allowedGroup,
    allowed_sub_group: allowedSubGroup,
    min_tier: minTier,
    min_sub_tier: minSubTier,
    is_black_list: isBlackList,
    countries: countries.map((c) => c.toUpperCase()),
  };
}

export { SANDBOX, PROD };
