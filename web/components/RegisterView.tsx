"use client";

import { short, units } from "@/lib/chain";
import type { Deployment, Position } from "@/lib/types";
import type { useLive } from "@/lib/useLive";
import { Addr, Badge, Empty, ErrorBox, Redacted, Skeleton, Tx } from "./bits";

export default function RegisterView({
  deployment,
  live,
  positions,
}: {
  deployment: Deployment;
  live: ReturnType<typeof useLive>;
  positions: Position[];
}) {
  const d = live.data;

  return (
    <div className="grid">
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
                  <th scope="col">Amount</th>
                  <th scope="col">Holder</th>
                  <th scope="col">Admitted under root</th>
                  <th scope="col">Entered</th>
                  <th scope="col">Tx</th>
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
      </section>
    </div>
  );
}
