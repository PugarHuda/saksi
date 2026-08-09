"use client";

import { useCallback, useState } from "react";
import {
  COMPLIANCE_VERIFY,
  SELECTORS,
  call,
  decodeDenyList,
  pad2,
  short,
} from "@/lib/chain";
import type { Asp, Deployment } from "@/lib/types";
import { Addr, Badge, ErrorBox } from "./bits";

/** Everything the register can tell a wallet about itself, and one thing it cannot. */
type Check = {
  address: string;
  gate1: boolean | null;        // Cleanverse's validator, live
  leaf: string | null;          // the pool derives it, so no hasher ships to the browser
  gate2: boolean;               // that leaf is in the anchored set
  denied: boolean;              // that leaf is on the on-chain sanctions list
};

const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());

export default function HolderView({
  deployment,
  asp,
}: {
  deployment: Deployment;
  asp: Asp | null;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Check | null>(null);

  const run = useCallback(
    async (addr: string) => {
      if (!deployment.pool || !deployment.validator || !asp) {
        setError("The register's deployment record is not loaded yet.");
        return;
      }
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        // Gate one is a live call to Cleanverse's contract. If their validator reverts —
        // which it does for a pool it has never heard of — that is an unknown, not a no.
        let gate1: boolean | null = null;
        try {
          const out = await call(deployment.validator, COMPLIANCE_VERIFY + pad2(deployment.pool, addr));
          gate1 = BigInt(out) === 1n;
        } catch {
          gate1 = null;
        }

        // Gate two is membership of the anchored set. The leaf is keccak(address) reduced
        // into the field, and the pool computes it, so this page needs no crypto library.
        const leafHex = await call(
          deployment.pool,
          SELECTORS.sourceKeyOf + addr.replace(/^0x/, "").toLowerCase().padStart(64, "0"),
        );
        const leaf = BigInt(leafHex).toString();
        const gate2 = asp.members.some((m) => m.sourceKey === leaf);

        const denied = decodeDenyList(await call(deployment.pool, SELECTORS.getDenyList))
          .some((d) => d !== 0n && d.toString() === leaf);

        setResult({ address: addr, gate1, leaf, gate2, denied });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [deployment.pool, deployment.validator, asp],
  );

  const connect = useCallback(async () => {
    // EIP-1193 straight off the injected provider. A wallet library for one request
    // would be several hundred kilobytes to read an address the browser already knows.
    const eth = (globalThis as { ethereum?: { request: (a: unknown) => Promise<string[]> } }).ethereum;
    if (!eth) {
      setError("No injected wallet found. Paste an address instead — this page only reads.");
      return;
    }
    try {
      const [addr] = await eth.request({ method: "eth_requestAccounts" });
      if (addr) {
        setInput(addr);
        run(addr);
      }
    } catch {
      setError("Wallet request was refused.");
    }
  }, [run]);

  const admitted = result && result.gate1 === true && result.gate2 && !result.denied;

  return (
    <div className="grid">
      <section className="card">
        <h2>Could this wallet enter the register?</h2>
        <p className="note" style={{ marginBottom: 14 }}>
          Every check below is read live from Monad — the left one from Cleanverse&apos;s own
          Validator, the others from this pool. Nothing is sent, nothing is stored, and no
          signature is requested.
        </p>

        <form
          className="row"
          style={{ gap: 8, flexWrap: "wrap" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (isAddress(input)) run(input.trim());
          }}
        >
          <label htmlFor="holder-address" className="sr-only">
            Wallet address
          </label>
          <input
            id="holder-address"
            className="input mono"
            style={{ flex: "1 1 22em", minWidth: 0 }}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-invalid={input.length > 0 && !isAddress(input)}
          />
          <button type="submit" className="btn primary" disabled={!isAddress(input) || busy}>
            {busy ? "Checking…" : "Check"}
          </button>
          <button type="button" className="btn ghost" onClick={connect} disabled={busy}>
            Use my wallet
          </button>
        </form>

        {input.length > 0 && !isAddress(input) && (
          <p className="note" style={{ color: "var(--refused)", margin: "8px 0 0" }}>
            That is not a 20-byte address.
          </p>
        )}

        {deployment.issuer && !result && !busy && (
          <p className="note" style={{ margin: "12px 0 0" }}>
            No wallet handy? Try the issuer,{" "}
            <button
              type="button"
              className="btn ghost"
              style={{ padding: "2px 8px", fontSize: "var(--t-xs)" }}
              onClick={() => {
                setInput(deployment.issuer!);
                run(deployment.issuer!);
              }}
            >
              {short(deployment.issuer, 10, 6)}
            </button>{" "}
            — it holds a credential and a position.
          </p>
        )}
      </section>

      {error && <ErrorBox message={error} onRetry={() => isAddress(input) && run(input.trim())} />}

      {result && (
        <>
          <section className="card">
            <h2>
              {admitted ? "This wallet can enter" : "This wallet cannot enter"}{" "}
              <Badge tone={admitted ? "ok" : "no"}>{admitted ? "admitted" : "refused"}</Badge>
            </h2>
            <p className="note">
              <Addr value={result.address} /> — three independent conditions, all of which
              must hold before <code className="mono">deposit()</code> will accept a position.
            </p>

            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Condition</th>
                    <th scope="col">Answer</th>
                    <th scope="col">Where it comes from</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Holds a credential that satisfies this pool&apos;s rule</td>
                    <td>
                      {result.gate1 === null ? (
                        <Badge tone="warn">no answer</Badge>
                      ) : result.gate1 ? (
                        <Badge tone="ok">yes</Badge>
                      ) : (
                        <Badge tone="no">no</Badge>
                      )}
                    </td>
                    <td className="note">
                      Cleanverse&apos;s Validator, called live —{" "}
                      <span className="mono">complianceVerify</span>
                    </td>
                  </tr>
                  <tr>
                    <td>Is a leaf in the association set the issuer anchored</td>
                    <td>{result.gate2 ? <Badge tone="ok">yes</Badge> : <Badge tone="no">no witness</Badge>}</td>
                    <td className="note">
                      leaf <span className="mono">{result.leaf ? short(result.leaf, 8, 6) : "—"}</span>{" "}
                      against {asp?.admitted ?? "—"} members
                    </td>
                  </tr>
                  <tr>
                    <td>Absent from the on-chain sanctions list</td>
                    <td>{result.denied ? <Badge tone="no">listed</Badge> : <Badge tone="ok">yes</Badge>}</td>
                    <td className="note">this pool&apos;s deny list</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {result.gate1 === false && result.gate2 && (
              <p className="callout" style={{ marginTop: 12 }}>
                This is the window the two gates exist for. The credential is refused
                <em> now</em>, but the anchored root still carries a witness for it, because
                the set has not been rebuilt since the credential changed. The live call is
                what closes that window.
              </p>
            )}
            {result.gate1 === true && !result.gate2 && (
              <p className="callout" style={{ marginTop: 12 }}>
                Credentialed after the last rebuild. Cleanverse admits this wallet and the
                anchored set has no witness for it yet — it enters once the issuer rebuilds.
              </p>
            )}
          </section>

          <section className="card">
            <h2>Does this wallet hold a position?</h2>
            <p style={{ margin: 0 }}>
              <strong>This register cannot tell you, and neither can anyone else.</strong> A
              position is a commitment; nothing on-chain links one to an address once it has
              moved. Only the holder&apos;s own key opens it.
            </p>
            <p className="note" style={{ margin: "12px 0 0" }}>
              Be precise about the boundary, though: an <em>entry</em> is public. A deposit
              has a visible sender and moves a visible amount, so the first owner of a
              freshly created commitment is readable from the transaction that created it.
              What the commitment protects is everything after that —{" "}
              {deployment.pool && (
                <>
                  and the register has already exercised it. One of those positions was later
                  disclosed in full — but only after a regulator posted the question on-chain,
                  which is the only way a figure ever leaves this register.
                </>
              )}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
