"use client";

import { isoMinute, short, units } from "@/lib/chain";
import type { Deployment, Measurement, Position } from "@/lib/types";
import type { useLive } from "@/lib/useLive";
import { Addr, Badge, Empty, ErrorBox, Redacted, Skeleton, Tx } from "./bits";

export default function RegisterView({
  deployment,
  live,
  positions,
  measurement,
}: {
  deployment: Deployment;
  live: ReturnType<typeof useLive>;
  positions: Position[];
  measurement: Measurement | null;
}) {
  const d = live.data;
  // commitmentCount() is every leaf ever inserted, spent ones included — it is a tree size,
  // not a holding. Labelling it "positions held" put an 8 above a table of four and made the
  // landing page, which counts live positions, look wrong.
  const inserted = d ? Number(d.positions) : null;
  const retired = inserted !== null ? inserted - positions.length : null;

  return (
    <div className="grid">
      {measurement && <WhyThisMatters m={measurement} />}
      <section className="grid three">
        <div className="card">
          <h2>Commitments inserted</h2>
          <p className="stat shielded mono">
            {live.status === "loading" ? <Skeleton w="3em" /> : d ? String(d.positions) : "—"}
          </p>
          <p className="note" style={{ margin: "8px 0 0" }}>
            {retired !== null && retired === 0 ? (
              <>
                <strong>{positions.length} listed, every one of them</strong>. The tree only
                grows: spending a note nullifies it but leaves its leaf in place, so this
                figure counts every commitment the register has ever held — and the bundle
                below lists all of them, live and spent alike, because it is built from the
                chain&apos;s own insertion log rather than from anyone&apos;s ledger.{" "}
                <strong>Which of them are still held is deliberately not published.</strong>{" "}
                It used to be, as a side effect of writing this bundle from the operator&apos;s
                ledgers — and that was enough to unwind the register: knowing the live set
                gives the spent set, which fixes the inputs of every two-in transfer by
                elimination, which makes value conservation solvable against the public deposit
                amounts. 270.1 CVA on leaf 4 was recovered that way, an amount no audit ever
                disclosed.
              </>
            ) : (
              <>
                The tree only grows: spending a note nullifies it but leaves its leaf in place,
                so this figure counts every commitment the register has ever held.
              </>
            )}
          </p>
        </div>

        <div className="card">
          <h2>Asset under register</h2>
          <p className="stat mono">
            {live.status === "loading" ? (
              <Skeleton w="5em" />
            ) : d ? (
              units(d.poolBalance, deployment.assetDecimals ?? 6)
            ) : (
              "—"
            )}
          </p>
          <p className="note" style={{ margin: "8px 0 0" }}>
            {deployment.assetSymbol ?? "CVA"} — the total is public, its distribution is not.
          </p>
        </div>

        <div className="card">
          <h2>Register state</h2>
          <p style={{ margin: "10px 0 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {live.status === "loading" ? (
              <Skeleton w="8em" />
            ) : d ? (
              <>
                {d.paused ? <Badge tone="no">Paused</Badge> : <Badge tone="ok">Open</Badge>}
                {d.registered ? (
                  <Badge tone="ok">Validator live</Badge>
                ) : (
                  <Badge tone="no">Unregistered</Badge>
                )}
              </>
            ) : (
              "—"
            )}
          </p>
          <p className="note" style={{ margin: "10px 0 0" }}>
            An unregistered pool fails closed: Cleanverse&apos;s validator reverts rather than
            answering, so entry stops.
          </p>
        </div>
      </section>

      {live.status === "error" && (
        <ErrorBox message={`Could not read Monad: ${live.error}`} onRetry={live.reload} />
      )}

      <section className="card">
        <h2>Anchors</h2>
        <p className="note">
          The register publishes two roots. The association-set root says which credentials may
          enter; the note root is the tree the shielded transfers spend against.
        </p>
        <dl className="kv">
          <dt>Association set</dt>
          <dd className="mono" style={{ fontSize: "var(--t-xs)" }}>
            {live.status === "loading" ? <Skeleton w="20em" /> : d ? d.aspRoot.toString() : "—"}
          </dd>
          <dt>Note tree</dt>
          <dd className="mono" style={{ fontSize: "var(--t-xs)" }}>
            {live.status === "loading" ? (
              <Skeleton w="20em" />
            ) : d ? (
              d.noteRoot === 0n ? (
                <span style={{ color: "var(--muted)" }}>not published yet</span>
              ) : (
                d.noteRoot.toString()
              )
            ) : (
              "—"
            )}
          </dd>
          <dt>Pool</dt>
          <dd>{deployment.pool ? <Addr value={deployment.pool} /> : "—"}</dd>
          <dt>Asset</dt>
          <dd>
            {deployment.asset ? <Addr value={deployment.asset} /> : "—"}{" "}
            <span className="note" style={{ display: "inline" }}>
              {deployment.assetName ? `· ${deployment.assetName}` : ""}
            </span>
          </dd>
          <dt>Validator</dt>
          <dd>{deployment.validator ? <Addr value={deployment.validator} /> : "—"}</dd>
        </dl>
      </section>

      <section className="card">
        <h2>The register</h2>
        <p className="note">
          Every leaf this register has ever held, in the order the tree took them — not the
          ones still held. That distinction is the point: this table used to list only live
          positions, and a reader who knows which are live knows which are spent, which fixes
          the inputs of every two-in transfer by elimination and makes the arithmetic solvable.
          They did not all arrive the same way. A <strong>deposit</strong> row entered through{" "}
          <code className="mono">deposit()</code>, and its entry is public by construction: the
          transaction in the last column carries a visible sender and a visible ERC-20 amount,
          so that figure is reconstructible from the chain and this register does not pretend
          otherwise. A <strong>transfer</strong> row was created inside the register by a
          JoinSplit — no association-set proof, no entry transaction, because it never entered;
          it moved.
        </p>

        {positions.length === 0 ? (
          <Empty>
            No positions yet. Run <code className="mono">node ops/deposit.mjs 250</code> to enter
            the register.
          </Empty>
        ) : (
          <div className="scroll">
            <table>
              <caption className="sr-only">Shielded positions in the register</caption>
              <thead>
                <tr>
                  <th scope="col">Commitment</th>
                  <th scope="col">Amount held</th>
                  <th scope="col">Current holder</th>
                  <th scope="col">Leaf</th>
                  <th scope="col">Inserted at</th>
                  <th scope="col">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const moved = p.origin !== "deposit";
                  return (
                    <tr key={p.commitment}>
                      <td className="mono">
                        {short(p.commitment, 10, 8)}
                        {moved && (
                          <span className="note" style={{ display: "block" }}>
                            created by transfer
                          </span>
                        )}
                      </td>
                      <td>
                        <Redacted />
                      </td>
                      <td>
                        <Redacted width={5} />
                      </td>
                      <td className="mono" style={{ fontSize: "var(--t-xs)" }}>
                        {p.leafIndex}
                      </td>
                      <td className="mono" style={{ fontSize: "var(--t-xs)" }}>
                        {p.block.toLocaleString("en-US")}
                      </td>
                      <td>
                        <Tx hash={p.tx} label={moved ? "transfer tx" : undefined} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="callout" style={{ marginTop: 14 }}>
          A conventional RWA platform publishes this table with real names and real numbers in
          the last two columns. That is the disclosure institutions will not accept — and the
          reason tokenized private credit stays on permissioned ledgers.
        </p>

        <p className="note" style={{ marginTop: 12 }}>
          <strong>Where the shielding starts, precisely.</strong> Entry is public by
          construction: a deposit transaction has a visible sender and moves a visible ERC-20
          amount, so the chain already links a deposited commitment to the wallet that opened
          it. What a JoinSplit is <em>built</em> to conceal is the book after positions move:
          the circuit publishes neither an amount nor an owner, so which input became which
          output is not on the chain. We do not publish the entry mapping in this bundle either,
          but that is courtesy rather than a guarantee, and it would be dishonest to present it
          as one.
        </p>
        <p className="note" style={{ marginTop: 12 }}>
          <strong>And that is the construction, not what is deployed here.</strong> The splitter
          that produced these particular transfers used a fixed 37/63 ratio — a constant in a
          public repository — and deposits are plaintext, so every note on this chain follows
          from the deposit log by arithmetic. <strong>Assume the current figures are readable.</strong>{" "}
          The splitter draws from the CSPRNG now; the notes already inserted do not, and a
          property is only as good as the operator&apos;s randomness. What still holds for these
          notes is the linkage, not the amounts: which input became which output is not
          published. The difference is the reviewer&apos;s to check, not ours to gloss.
        </p>
      </section>
    </div>
  );
}

/** The problem, as a measurement rather than an assertion. A verified asset only moves
 *  between credentialed wallets, so the credentialed set is the complete set of possible
 *  holders — this census is exhaustive over it, not a sample of it. */
function WhyThisMatters({ m }: { m: Measurement }) {
  const pct = m.assetsWithHolders
    ? Math.round((m.assetsUnderFiveHolders / m.assetsWithHolders) * 100)
    : 0;

  return (
    <section className="card">
      <h2>Why a register needs to be confidential</h2>
      <p className="note">
        A census, not a sample: every balance of every verified asset on {m.chain}, read
        against all {m.walletsEnumerated} credentialed wallets — the complete set of parties
        a verified asset is permitted to move to.
      </p>

      <div className="grid three" style={{ marginBottom: 12 }}>
        <div className="card" style={{ background: "var(--surface-2)" }}>
          <h3>Median holders per asset</h3>
          <p className="stat accent mono">{m.medianHolders}</p>
        </div>
        <div className="card" style={{ background: "var(--surface-2)" }}>
          <h3>Fewer than five holders</h3>
          <p className="stat mono">
            {m.assetsUnderFiveHolders}
            <span style={{ fontSize: "var(--t-lg)", color: "var(--muted)" }}> / {m.assetsWithHolders}</span>
          </p>
          <p className="note" style={{ margin: "6px 0 0" }}>{pct}% of assets measured</p>
        </div>
        <div className="card" style={{ background: "var(--surface-2)" }}>
          <h3>One wallet over 90% of supply</h3>
          <p className="stat mono">{m.assetsWithDominantHolder}</p>
        </div>
      </div>

      <p className="callout">
        An anonymity set of {m.medianHolders} is not anonymity. Knowing the asset and watching
        one transfer identifies the position and its size. This is not a quiet-testnet
        artefact — it is the mechanism: <strong>the tighter an asset&apos;s holder rule, the
        smaller the crowd its holders hide in.</strong> Eligibility restricts the population by
        design, so compliance and confidentiality pull against each other structurally.
      </p>

      <p className="note" style={{ margin: "12px 0 0" }}>
        Measured {m.measuredAt.replace("T", " ").slice(0, 16)} UTC. {m.caveat} — the error can
        only run one way, so these are upper bounds on privacy. Reproduce with{" "}
        <code className="mono">node ops/measure-register.mjs</code>.
      </p>
    </section>
  );
}
