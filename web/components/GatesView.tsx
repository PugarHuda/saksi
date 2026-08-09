"use client";

import { useCallback, useEffect, useState } from "react";
import { RPC, short } from "@/lib/chain";
import type { Asp, Deployment } from "@/lib/types";
import { Addr, Badge, ErrorBox, Skeleton } from "./bits";

const CV = "0xaf375463"; // complianceVerify(address,address) on Cleanverse's validator
const pad = (a: string) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");

const BURN = "0x000000000000000000000000000000000000dEaD";
const ONES = "0x1111111111111111111111111111111111111111";

type Row = {
  address: string;
  name: string;
  gate1: boolean | null;
  gate2: boolean;
  gate2Prev: boolean | null;   // null = no earlier set on record
};

export default function GatesView({
  deployment,
  asp,
}: {
  deployment: Deployment;
  asp: Asp | null;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const subjects: [string, string][] = [
    [BURN, "the burn address"],
    [ONES, "0x1111…1111"],
    ...(deployment.issuer ? ([[deployment.issuer, "issuer"]] as [string, string][]) : []),
    ...(deployment.pool ? ([[deployment.pool, "the pool contract itself"]] as [string, string][]) : []),
    // Only our own dropped credentials carry an address now — a third party's wallet is
    // published as a leaf, and there is nothing to ask the validator about.
    ...((asp?.dropped ?? [])
      .filter((d) => !!d.wallet)
      .map((d) => [d.wallet, `revoked · ${d.label ?? "holder"}`]) as [string, string][]),
  ];

  const load = useCallback(async () => {
    // Without these the skeletons would shimmer forever with no error and no empty state —
    // and this is the tab carrying the argument, so a silent hang is the worst outcome.
    if (!deployment.validator || !deployment.pool || !asp) {
      setError(
        "No association set or validator recorded yet. Run `node ops/asp.mjs build` and register the pool.",
      );
      setRows([]);
      return;
    }
    setError(null);
    try {
      // Membership is a property of the LEAF, not of an address the published set no
      // longer carries. Comparing on m.wallet threw on the 510 leaf-only members; making
      // it optional would answer "no witness" for every subject and print the burn-address
      // claim this project formally retracted. sourceKey is precomputed by ops/asp.mjs,
      // where keccak already lives, because this console ships no hasher.
      const keyOf = (a: string) =>
        asp.subjects?.find((s) => s.address.toLowerCase() === a.toLowerCase());

      const out = await Promise.all(
        subjects.map(async ([address, name]) => {
          let gate1: boolean | null = null;
          try {
            const res = await fetch(RPC, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_call",
                params: [
                  { to: deployment.validator, data: CV + pad(deployment.pool!) + pad(address) },
                  "latest",
                ],
              }),
              cache: "no-store",
            });
            const body = await res.json();
            gate1 = body.error ? null : BigInt(body.result) === 1n;
          } catch {
            gate1 = null;
          }
          const s = keyOf(address);
          return {
            address,
            name,
            gate1,
            gate2: s?.inSet ?? false,
            gate2Prev: s ? s.inPreviousSet : null,
          };
        }),
      );
      setRows(out);
    } catch (e) {
      setError((e as Error).message);
    }
    // subjects is derived from props on every render; the deps below are its real inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployment.validator, deployment.pool, deployment.issuer, asp]);

  useEffect(() => {
    load();
  }, [load]);

  const disagreements = rows?.filter((r) => (r.gate1 === true) !== r.gate2) ?? [];
  // Refused live, but the previous anchored root still admits them. This is the temporal
  // divergence the two gates exist for, and it is invisible without the earlier set.
  const stale = rows?.filter((r) => r.gate1 === false && r.gate2Prev === true) ?? [];

  return (
    <div className="grid">
      <section className="card">
        <h2>Two gates, and they are not redundant</h2>
        <p className="note" style={{ marginBottom: 0 }}>
          Gate one is Cleanverse&apos;s own Validator, asked live inside the transaction that
          moves the value. Gate two is membership of the association set the issuer anchored,
          proved in zero knowledge. The cheapest way to show they are different questions is
          to find an address they disagree about.
        </p>
      </section>

      {error && <ErrorBox message={error} onRetry={load} />}

      <section className="card">
        <h2>Live comparison</h2>
        <p className="note">
          Both columns are read now: the left from Cleanverse&apos;s contract, the right from
          the set anchored at{" "}
          <code className="mono">{asp ? short(asp.root, 10, 6) : "—"}</code>
          {asp && ` · ${asp.admitted} members · built ${asp.builtAt.replace("T", " ").slice(0, 16)} UTC`}.
        </p>

        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Subject</th>
                <th scope="col">Gate 1 · Cleanverse Validator</th>
                <th scope="col">Gate 2 · set now</th>
                <th scope="col">Gate 2 · set before the last rebuild</th>
                <th scope="col">Enters the register?</th>
              </tr>
            </thead>
            <tbody>
              {!rows
                ? subjects.map(([a]) => (
                    <tr key={a}>
                      <td><Skeleton w="12em" /></td>
                      <td><Skeleton w="6em" /></td>
                      <td><Skeleton w="6em" /></td>
                      <td><Skeleton w="6em" /></td>
                      <td><Skeleton w="4em" /></td>
                    </tr>
                  ))
                : rows.map((r) => {
                    const split = (r.gate1 === true) !== r.gate2;
                    return (
                      <tr key={r.address}>
                        <td>
                          <Addr value={r.address} />
                          <span className="note" style={{ display: "block" }}>{r.name}</span>
                        </td>
                        <td>
                          {r.gate1 === null ? (
                            <Badge tone="warn">no answer</Badge>
                          ) : r.gate1 ? (
                            <Badge tone="ok">admits</Badge>
                          ) : (
                            <Badge tone="no">refuses</Badge>
                          )}
                        </td>
                        <td>
                          {r.gate2 ? (
                            <Badge tone="ok">admits</Badge>
                          ) : (
                            <Badge tone="no">no witness</Badge>
                          )}
                        </td>
                        <td>
                          {r.gate2Prev === null ? (
                            <span className="note">—</span>
                          ) : r.gate2Prev ? (
                            <Badge tone="warn">admits</Badge>
                          ) : (
                            <Badge tone="no">no witness</Badge>
                          )}
                        </td>
                        <td>
                          {r.gate1 === true && r.gate2 ? (
                            <Badge tone="ok">yes</Badge>
                          ) : (
                            <Badge tone={split ? "warn" : "no"}>no</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      </section>

      {rows && (
        <section className="card">
          <h2>What the comparison found</h2>
          {stale.length > 0 ? (
            <p className="callout">
              <strong>{stale.map((d) => d.name).join(", ")}</strong> is refused by Cleanverse
              right now, holds no witness in the current set — and{" "}
              <strong>is still admitted by the root anchored before the last rebuild</strong>.
              That is the window the live gate exists to close: between a credential changing
              and the issuer rotating the root, the anchored set is stale by construction. The
              live call refuses them today; the anchored set is what still binds when an
              operator never rotates. Neither gate subsumes the other.
            </p>
          ) : disagreements.length === 0 ? (
            <p style={{ margin: 0 }}>
              The gates agree on every subject checked right now, which is the correct result:
              the set is built from the registry, so it is never more permissive than it. The
              divergence this tab exists to show is temporal — freeze a credential without
              rotating the root and it appears in the last column.
            </p>
          ) : (
            <p className="callout">
              <strong>{disagreements.map((d) => d.name).join(", ")}</strong>{" "}
              {disagreements.length === 1 ? "is" : "are"} answered differently by the two gates
              as of this moment. Read the last column before drawing a conclusion: a subject
              the live call refuses while the previous root admits is the stale window, not a
              defect in either gate.
            </p>
          )}

          <p className="note" style={{ margin: "12px 0 0" }}>
            An earlier version of this panel pointed at the burn address and claimed the ZK
            gate caught what the live gate missed. That was our own bug: a status filter had
            removed seven eighths of the eligible population, and{" "}
            <code className="mono">0x…dEaD</code> fell out because of it. With the population
            enumerated correctly both gates admit it. The set is faithful to the registry, and
            never more permissive than it.
          </p>
          <p className="note" style={{ margin: "12px 0 0" }}>
            Reproduce from a terminal: <code className="mono">node ops/gate-gap.mjs</code>
          </p>
        </section>
      )}
    </div>
  );
}
