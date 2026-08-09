"use client";

import { short, units } from "@/lib/chain";
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

  return (
    <div className="grid">
      {measurement && <WhyThisMatters m={measurement} />}
      <section className="grid three">
        <div className="card">
          <h2>Positions held</h2>
          <p className="stat shielded mono">
            {live.status === "loading" ? <Skeleton w="3em" /> : d ? String(d.positions) : "—"}
          </p>
          <p className="note" style={{ margin: "8px 0 0" }}>
            Commitments in the register. Who holds them, and for how much, is not on chain.
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
          <dd className="mono" style={{ fontSize: 12.5 }}>
            {live.status === "loading" ? <Skeleton w="20em" /> : d ? d.aspRoot.toString() : "—"}
          </dd>
          <dt>Note tree</dt>
          <dd className="mono" style={{ fontSize: 12.5 }}>
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
          Every row is a position this contract is holding. The amount column is the point of
          the product: the register knows it, the chain stores a commitment to it, and no
          observer can read it.
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
                  <th scope="col">Admitted under root</th>
                  <th scope="col">Entered</th>
                  <th scope="col">Entry tx</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.commitment}>
                    <td className="mono">{short(p.commitment, 10, 8)}</td>
                    <td>
                      <Redacted />
                    </td>
                    <td>
                      <Redacted width={5} />
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {short(p.aspRoot, 8, 6)}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {new Date(p.provedAt).toISOString().replace("T", " ").slice(0, 16)}
                    </td>
                    <td>
                      <Tx hash={p.depositTx} />
                    </td>
                  </tr>
                ))}
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
          amount, so the chain already links this commitment to the wallet that opened it. What
          the register conceals is the book <em>after</em> positions move — a JoinSplit spends
          notes and creates new ones without publishing an amount or an owner, so who holds
          what stops tracking who deposited what. We do not publish the entry mapping in this
          bundle either, but that is courtesy rather than a guarantee, and it would be
          dishonest to present it as one.
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
            <span style={{ fontSize: 15, color: "var(--muted)" }}> / {m.assetsWithHolders}</span>
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
