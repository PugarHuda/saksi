# Cleanverse API — verified findings

Probed 2 Aug 2026, chain table re-probed and updated **6 Aug 2026**.

Full docs saved to `docs-cleanverse.txt` (137k chars).
Docs are gated behind an access code and served from `docs.cleanverse.com/docs/cleanverse`
inside an iframe; Cloudflare blocks plain curl, so re-fetch with a browser session.

## Credentials — tested live, all working

| Item | Value | Status |
|---|---|---|
| Sandbox base | `https://uatapi.cleanverse.com/api/cooperate` | ✅ |
| Production base | `https://api.cleanverse.com/api/cooperate` | — |
> The api-id was committed in this row and served publicly until the history was
> rewritten on 9 Aug. It has **not** been rotated: Cleanverse have said the hackathon
> credentials are disabled once the event closes. Treat it as burned.

| `api-id` header | `APP2026…` (redacted) | ✅ `query_ramp_countries` → `0000 success` |
| `api-key` (AES only, never sent) | AES-256-CBC, **IV = 16 zero bytes**, PKCS5/7, key = base64-decode of the api-key | ✅ server decrypted our ciphertext (`validator/set_rule` → `10002 rule is required`) |

**API is v5.6, not v3.** The docs site `<title>` still says v3 — it is stale. Latest
changes: v5.6 validator country allow/deny, v5.5 A-Pass country tags, v5.4 Fiat Ramp.

## The chain constraint — decisive

`POST /validator/is_register` probed across every documented chain:

| Chain | Validator on-chain module |
|---|---|
| **monad** | ✅ live — **our deployment target** |
| base, ethereum, polygon, bsc, hashkey | ✅ live |
| solana, avalanche, arbitrum, platon | ❌ `12027 Validator is-register returned no data` |

**Changed on 6 Aug.** On 2 Aug only `base` and `polygon` answered; Cleanverse has since
deployed the Validator to `ethereum`, `bsc`, `hashkey` and -- decisively -- **`monad`**.
Confirmed twice, stable across runs.

Implication: the deepest available CVI hook (registering our own pool contract with
Cleanverse's on-chain Validator) is now possible **on the sponsor chain**. The earlier
Base fallback is no longer needed. **Deploy on Monad.**

A-Pass accepted `monad` all along; only the Validator module lagged. They are separate
deployments, so do not assume one implies the other. Re-run `saksi/scripts/smoke.mjs`
before deploying -- availability has already moved once.

## What this unlocks for Saksi

### 1. `/validator/register` is the primitive the whole design wanted
Register **our own pool contract address** with Cleanverse's Validator and attach
compliance rules. Cleanverse then enforces eligibility on-chain against each wallet's
A-Pass. The compliance gate is *their* contract, not our reimplementation of one —
which is the strongest possible answer to "is CVI load-bearing?".

Requirements: the pool must expose `Ownable.owner()`, and the owner signs an EIP-191
signature over `chain + contract_address`. Encrypted request body.

Rule object (`register` / `set_rule` / `add_rule`):

| Field | Meaning |
|---|---|
| `allowed_group` / `allowed_sub_group` | A-Pass group match, 1–2 chars, empty = no constraint |
| `min_tier` / `min_sub_tier` | 0–99, user allowed if tier **greater than** this |
| `is_black_list` | `true` = deny-list countries, `false`/omitted = allow-list |
| `countries[]` | ISO 3166-1 alpha-2 |

Read endpoints (`is_register`, `rules`, `verify`, `is_paused`) take **plain JSON**.
Writes (`grant`, `register`, `set_rule`, `add_rule`, `remove_rule`, `set_paused`) are
encrypted and return a `tx_hash`. Wait for confirmation between rule mutations.

`POST /validator/verify` → `{ valid: true|false }`. HTTP 200 + `0000` means the check
ran; `valid` is the outcome, not an error.

### 2. A-Pass fields we can bind in-circuit
`POST /query_apass` returns flat fields only:

```
cvRecordId, tier, subTier, group, subGroup,
status          1 = Activate, 2 = Freeze
expirationTime  Unix seconds
currentKycHash  32-byte hex
countries[]     ISO alpha-2, derived from identityDataList[].issuingCountryISO2
```

`currentKycHash` is the natural **Merkle leaf** for the association set — already a
32-byte hash, stable per identity. `status = 2` and `expirationTime` are the
revocation and expiry events the freeze demo depends on. Bulk export for building the
tree: `POST /query_apass_list` (paginated, institution-scoped).

Deposit addresses are **not** in `query_apass` — use `POST /query_deposit_address`.

### 3. CVA issuance, which Track 1 requires "from the issuance stage"
`POST /atoken/launch` (encrypted) launches an A-Token with `token_name`,
`token_symbol`, `decimals`, `admin_address`, `icon`, and the same rule object.
So Saksi launches its own A-Token as the tokenized note, then builds the confidential
register over it. That satisfies "integrated from the issuance stage" literally rather
than by argument.

Related: `register_atoken`, `launch_wrapped_atoken` (wrap an existing stablecoin),
`add_rule` / `remove_rule` / `rules`, `set_paused`, institutional deposit whitelist,
`GET /atoken/list_my_atokens`, apply-status webhook with HMAC.

### 4. Supporting pieces
- `POST /blacklist/add` — drives the revocation demo.
- `POST /download_travel_rule` — returns a real PDF; the audit pack can ship genuine
  Travel Rule documents rather than a mock.
- Fiat Ramp module (`query_ramp_*`, `create_ramp_widget_url`) — plain JSON, two-step
  quote → widget flow. Not needed for Saksi, but this is the Gateway Network whitespace
  nobody in the field is touching.

## Error codes worth knowing
`0000` success · `0001` bad parameter · `0002` business failure (bracketed sub-code in
`message`) · `10002` missing required field · `12026` validator on-chain write failed ·
`12027` validator on-chain read failed · `403` bad api-id, unallowed IP, or AES
decryption failure.

## Open questions for the developer Telegram (t.me/Cleanverselabs)
1. ~~Will the Validator module be enabled on Monad before Aug 8?~~ **Answered by probe
   on 6 Aug: yes, Monad is live.** No need to ask.
2. Is there a **published ABI / contract address** for the Validator, so a Solidity pool
   can call the eligibility check directly on-chain instead of via `/validator/verify`?
3. Is there a **revocation webhook**, or must we poll `query_apass` for
   `status = 2` and `expirationTime`?
4. Sandbox A-Pass fixtures: can we get several test wallets with **different tiers and
   country tags**, plus one we can freeze on demand for the demo?
