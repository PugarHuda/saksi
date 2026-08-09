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

  addAtokenRule(chain, atoken_address, rule) {
    return this.post("atoken/add_rule", { chain, atoken_address, rule });
  }

  applyStatus(requestId) { return this.get(`atoken/query_apply_status/${requestId}`); }

  listMyAtokens(params = {}) { return this.get("atoken/list_my_atokens", params); }

  // ---- Compliance evidence --------------------------------------------

  blacklistAdd(params) { return this.post("blacklist/add", params); }

  /** Returns { downloadUrl, fileName } for a real Travel Rule PDF. */
  downloadTravelRule(params) { return this.post("download_travel_rule", params); }
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
