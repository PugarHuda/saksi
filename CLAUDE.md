# Saksi

A shielded register for a Cleanverse A-Token. Holders' balances are private; an
auditor's questions about those balances get answered with zero-knowledge proofs,
on-chain, in a way a stranger can check without trusting anyone here.

Built for the Cleanverse Build: Trusted Assets Hackathon, RWA track.

## Run it

```bash
npm test                      # parses every ops script, then runs the Foundry suite
                              # (173 at the last count, including 9 invariants — but run it,
                              #  this line has already been wrong once)
node ops/evidence.mjs         # rebuild the evidence table from the chain
node ops/evidence.mjs --md    # same, markdown, for SUMMARY.md
cd web && npm run dev         # console at localhost:3000
cd web && npx playwright test # e2e against the console; BASE_URL=https://saksi-gilt.vercel.app
                              # runs the same suite against production, which is the one that counts
```

`ops/evidence.mjs`, `ops/gas.mjs`, and `ops/cva-gate.mjs` are read-only and safe
to run at any time. Five scripts broadcast transactions — `deposit.mjs`,
`transfer.mjs`, `audit.mjs`, `setup-pool.mjs`, `seed-holders.mjs` — and three
more mutate state through the Cleanverse API without touching the chain:
`apass.mjs` (issues and freezes credentials), `validator.mjs` (registers the
pool's rule), `asp.mjs` (rewrites the association set). **Read a script before
running it**; "it does not call `send()`" is not the same as "it is safe".

## Layout

| Path | What |
|---|---|
| `contracts/` | `SaksiPool.sol` + 6 Groth16 verifiers, Foundry |
| `circuits/` | 7 Circom circuits, BN254, depth 10 |
| `ops/` | Node scripts that operate the register — the only holder of note secrets |
| `web/` | Next.js console, deployed to Vercel |
| `docs/` | Cleanverse API notes (gitignored — contains sandbox specifics) |

`SUMMARY.md` is the judged writeup and the closest thing to a spec. `DEMO.md` is
the video script. `README.md` is the entry point for a stranger.

## Things that will bite you

**Do not redeploy the pool.** `deployment.json:pool` is live and its value is
its history: two audit requests have been open since a named block, and the
whole point is that the question was registered before the answer existed. A
redeploy resets that to nothing. Source fixes that are not on-chain are listed
in `SUMMARY.md` as exactly that — known, deliberate, documented.

**Secrets that cannot be regenerated.** A note's `blinding` exists in
`notes*.json` and nowhere else — not on chain, not derivable. Lose it and the
position is permanently unspendable. `.env`, `wallets.json`, `notes.json`,
`notes.*.json`, `asp.json`, `*.bak`, and `.artifacts/` are gitignored and must
stay that way. The Cleanverse api-key is used to derive an AES key locally and
is never sent on the wire.

**Spending needs the private key; disclosure needs only `(amount, pubKey,
blinding)`.** That asymmetry is the design, and it is also the trap: handing
someone a note's blinding hands them the full disclosure witness for it.

**`RuleV2` is six fields**, not five: `bytes2 allowedGroup, bytes2
allowedSubGroup, uint8 minTier, uint8 minSubTier, bool isBlackList, uint256
countryBitmap`. Encoding five words for a six-word decoder fails silently.

**The Cooperate API encrypts about twenty endpoints and leaves the rest plain
JSON.** Sending an encrypted body to a plain endpoint returns success (`0000`)
and ignores the body. A green response is not evidence the call did anything.

**Monad testnet charges the gas limit you submit and reports it as `gasUsed`.**
Every gas figure in this repo comes from `eth_estimateGas`, not from a receipt.
`eth_getLogs` is capped at 100 blocks per request.

**Shell quoting on Windows.** `node -e` and Python heredocs mangle backticks,
`\d`, and `\[`. Write the script to the scratchpad and run it by path.

## Convention

Comments explain **why**, never what. A comment that restates the line is
deleted. Where a limit is deliberate, the comment names the limit and what
breaks if it moves — the circuit headers are the model for this.

Every number in `SUMMARY.md` and `README.md` is reproducible by a command in
this repo. If you change a number, change it by re-running the command.
