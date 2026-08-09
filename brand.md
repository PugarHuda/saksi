# Brand — Saksi

_Status: active_

**Saksi** is Indonesian for *witness*. In zero-knowledge the private input is literally
called the witness; in law a witness is someone who can testify to a fact without
disclosing everything they know. Both meanings land on the product, which is why the name
carries the whole idea.

Tagline: **Every position witnessed. Disclosure only when asked.**

The earlier line was "nothing revealed", and it was retired because it is not true of an
entry: a deposit transaction has a visible sender and moves a visible amount, so the chain
already discloses that. The product's real claim is narrower and stronger — nothing is
disclosed unless somebody asks on-chain first, and the answer is a proof rather than a
promise. Copy anywhere in this product must survive a reader with a block explorer open.

## Palette

Taken from the mark: a solid arc above the commitment (the witnessed half) and a dashed
arc below it (the shielded half, present and counted but never readable).

| Token | Light | Dark | Role |
|---|---|---|---|
| `--background` | `#F7F8FA` | `#0B0F1A` | page ground — the ink of the mark |
| `--surface` | `#FFFFFF` | `#121826` | cards, panels |
| `--surface-2` | `#EDEFF4` | `#1A2233` | table rows, insets |
| `--border` | `#DCE0E8` | `#232C3F` | hairlines |
| `--foreground` | `#0B0F1A` | `#E6EAF2` | body text |
| `--muted` | `#5B6478` | `#8C97AD` | secondary text, labels |
| `--accent` | `#B8860B` | `#E9B949` | the gold of the mark — signal, never decoration |
| `--verified` | `#0F7B4F` | `#3DD68C` | admitted, settled, proof verified |
| `--refused` | `#B4232B` | `#F2555F` | refused, revoked, frozen |
| `--shielded` | `#6B4FBB` | `#A78BFA` | the private half — commitments, hidden amounts |

Contrast: every foreground/background pair above clears WCAG AA at body size. `--muted`
on `--surface` is the tightest pair and is reserved for labels at 13px+ weight 500.

**Rule for the accent.** Gold marks the thing a reader must not miss — a live root, a
verification hash, an active rule. It is never a background wash and never used twice in
one view for two different meanings.

## Typography

- UI: **Geist Sans** via `next/font`.
- Numbers, hashes, roots, addresses: **Geist Mono**, always. A field element rendered in
  a proportional face is unreadable and, worse, unverifiable by eye.
- Scale: 12 / 13 / 14 / 16 / 20 / 28. Labels 12–13 uppercase tracking-wide in `--muted`;
  values 14–16 mono in `--foreground`.

## Voice

Institutional, plain, and unhedged. The product's whole claim is that a statement can be
checked, so the copy states things and shows the evidence beside them.

- Say what happened: "Refused — credential frozen", not "Something went wrong".
- Name the rule that bit: "min_tier 30", not "policy violation".
- Never say "secure", "trustless", or "revolutionary". Show the transaction hash instead.
- Amounts that are deliberately hidden are written as `••••••`, never as `0` or `—`,
  because a hidden figure and an absent one are different facts.

## Co-branding

Cleanverse's mark is monochrome, so it sits on the dark ground without competing with the
gold. Use `logo icon -white.svg` from their media kit at the same optical size as the
Saksi mark, separated by a hairline, with the relationship stated in words — Saksi is
built on Cleanverse, not affiliated with it.
