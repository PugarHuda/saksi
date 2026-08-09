"use client";

import { useCallback, useEffect, useState } from "react";
import { RPC, short } from "@/lib/chain";
import type { Asp, Deployment } from "@/lib/types";
import { Addr, Badge, ErrorBox, Skeleton } from "./bits";

const CV = "0xaf375463"; // complianceVerify(address,address) on Cleanverse's validator
const pad = (a: string) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");

const BURN = "0x000000000000000000000000000000000000dEaD";
const ONES = "0x1111111111111111111111111111111111111111";

type Row = { address: string; name: string; gate1: boolean | null; gate2: boolean };

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
    ...((asp?.dropped ?? []).map((d) => [d.wallet, `revoked · ${d.label ?? "holder"}`]) as [string, string][]),
  ];

  const load = useCallback(async () => {
    if (!deployment.validator || !deployment.pool || !asp) return;
    setError(null);
    try {
      const inSet = (a: string) =>
        asp.members.some((m) => m.wallet.toLowerCase() === a.toLowerCase());

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
          return { address, name, gate1, gate2: inSet(address) };
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
                <th scope="col">Gate 2 · association set</th>
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
          {disagreements.length === 0 ? (
            <p style={{ margin: 0 }}>
              The gates agree on every subject checked right now. Re-run after a credential
              changes — the interesting cases appear between a freeze and a rebuild.
            </p>
          ) : (
            <>
              <p className="callout">
                Cleanverse&apos;s validator answers that{" "}
                <strong>{disagreements.map((d) => d.name).join(", ")}</strong>{" "}
                {disagreements.length === 1 ? "satisfies" : "satisfy"} this pool&apos;s rule.
                Someone in the shared sandbox issued that address a credential, so gate one
                admits it. Gate two has no membership witness for it, so no proof exists and it
                does not enter.
              </p>
              <p className="note" style={{ margin: "12px 0 0" }}>
                The honest half of the same result: <code className="mono">0x1111…1111</code> is
                in our set, because it is in the registry. The association set is faithful to
                Cleanverse, not cleaner than it. What the second gate adds is not better
                identity data — it is a second, independent question, anchored by the issuer at
                a point in time, that an address has to satisfy as well.
              </p>
            </>
          )}
          <p className="note" style={{ margin: "12px 0 0" }}>
            Reproduce from a terminal: <code className="mono">node ops/gate-gap.mjs</code>
          </p>
        </section>
      )}
    </div>
  );
}
