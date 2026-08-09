# ops/

Node ESM scripts that operate the register. **This directory holds the only copy
of secrets that cannot be regenerated.**

## Read-only vs. sending

Safe to run any time:

```bash
node ops/evidence.mjs [--md]   # rebuild the evidence table from chain
node ops/gas.mjs               # gas figures via eth_estimateGas
node ops/cva-gate.mjs          # the two gates, side by side
node ops/check.mjs             # does every script here still parse? (wired into npm test)
```

Read-only against the chain but it **overwrites `notes.public.json`**, which is why it is not
in the list above — this file warns against exactly that reading:

```bash
node ops/publish-index.mjs [--dry]
```

`publish-index.mjs` reads the index out of the chain's own insertion log and never opens a
ledger. That is not a convenience: the index used to be written from the ledgers, which drop a
position when it is spent, so the published file WAS the live set — and nothing else publishes
that, since a nullifier cannot be tied to its leaf without the key. An adversarial review took
the spent set by subtraction, forced every JoinSplit's inputs by elimination, and recovered
270.1 CVA on leaf 4 that no audit had disclosed. **Never reintroduce a liveness field here.**

Everything else changes something. Five broadcast transactions —
`deposit.mjs`, `transfer.mjs`, `audit.mjs`, `setup-pool.mjs`,
`seed-holders.mjs`. Three mutate through the Cleanverse API without ever
touching the chain, which makes them easy to misread as harmless: `apass.mjs`
issues and freezes credentials, `validator.mjs` registers the pool's rule,
`asp.mjs` rewrites the association set. Several more write local ledgers.

**Grepping for `send(` does not tell you whether a script is safe.** Read it.

## The irreversible part

`notes.json` / `notes.*.json` hold each position's `blinding`. It is not on
chain and not derivable from anything that is. **A script that broadcasts a
transaction and then dies before writing the file has put money into the pool
that nobody can ever take out.** Persist the secret *before* the send. This is
why `transfer.mjs` writes secrets first and only then broadcasts.

Gitignored and must stay so: `.env`, `wallets.json`, `notes.json`,
`notes.*.json`, `asp.json`, `asp.previous.json`, `*.pool-0x*.bak`,
`.artifacts/`, `docs/HANDOFF.md`, `docs/docs-cleanverse.txt`.

The public counterparts — `notes.public.json`, `asp.public.json`,
`audit-log.json`, `transfers.json` — are committed on purpose. A commitment is
public. Omitting one from the index understates the register.

## Shared helpers — a bug here is a bug everywhere

`env.mjs` (`ROOT`, `RPC`, `readDeployment`, `readAsp`, `readOrExit`),
`note.mjs` (`notesFile`, `loadAllNotes`, `writePublicIndex`),
`cleanverse.mjs` (the API client, AES, `APASS_VERDICT`).

## Things that will bite you

**`cleanverse.mjs` encrypts about twenty endpoints and sends the rest as plain
JSON.** An encrypted body to a plain endpoint returns `0000` — success — and is
silently ignored. A green response proves nothing happened wrong; it does not
prove anything happened.

**AES-256-CBC, 16 zero bytes for the IV, key = base64-decode(api-key).** The
key is derived locally and never leaves the machine.

**A transfer must publish the note root containing its own new leaves.**
Otherwise the recipient's position has no Merkle path into any known root and is
unspendable until the sender chooses to act again — and `publishNoteRoot` is
`onlyOwner`, so that is a sender-held veto over a note already given away. This
bug appeared twice, in two scripts, because it was fixed where it was found
rather than where it belonged.

**The sender must not retain the recipient's blinding.** Keeping it means
keeping the full disclosure witness for a position you no longer own.

**Amount splits must come from a CSPRNG.** A fixed ratio made every amount in
the register derivable from the total.

**Read the live deny list; never hardcode it.** A stale copy fails with
`DenyListMismatch` at best, and at worst proves against a set that no longer
matches the chain.

**A frozen credential is not an admitted one.** `status != 1` must be excluded
from the association set — but `status == null` means *unknown*, not frozen, and
treating those as failures dropped 15 valid credentials once.

**Only `Assert Failed` counts as a disclosure answer.** Other revert shapes mean
the call did not reach the assertion.

**Monad testnet reports the submitted gas limit as `gasUsed`.** Take gas from
`eth_estimateGas`. `eth_getLogs` caps at 100 blocks per request.

**Windows shell quoting** mangles backticks, `\d`, `\[` inside `node -e`. Write
the script to the scratchpad and run it by path.
