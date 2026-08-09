"use client";

import { useCallback, useEffect, useState } from "react";
import { SELECTORS, call, decodeRules, readAddress, readBool, readUint, type RuleV2 } from "./chain";
import type { Deployment } from "./types";

export type Live = {
  aspRoot: bigint;
  noteRoot: bigint;
  positions: bigint;
  registered: boolean;
  paused: boolean;
  owner: string;
  auditor: string;
  poolBalance: bigint;
  supply: bigint;
  rules: RuleV2[];
};

type State =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: Live; error: null }
  | { status: "error"; data: Live | null; error: string };

/** Everything here is read from the chain on every load. The console deliberately has no
 *  cache: a compliance figure that is one refresh stale is a compliance figure that is
 *  wrong, and the whole product claim is that the screen agrees with the chain. */
export function useLive(deployment: Deployment) {
  const [state, setState] = useState<State>({ status: "loading", data: null, error: null });
  const pool = deployment.pool;
  const asset = deployment.asset;

  const load = useCallback(async () => {
    if (!pool || !asset) {
      setState({ status: "error", data: null, error: "No deployment recorded yet." });
      return;
    }
    // A refresh keeps whatever is already on screen; only a cold load shows skeletons.
    setState((s) => (s.data ? s : { status: "loading", data: null, error: null }));
    try {
      const [aspRoot, noteRoot, positions, registered, paused, owner, auditor, poolBalance, supply, rulesHex] =
        await Promise.all([
          readUint(pool, SELECTORS.aspRoot),
          readUint(pool, SELECTORS.noteRoot),
          readUint(pool, SELECTORS.commitmentCount),
          readBool(pool, SELECTORS.registeredWithValidator),
          readBool(pool, SELECTORS.paused),
          readAddress(pool, SELECTORS.owner),
          readAddress(pool, SELECTORS.auditor),
          readUint(asset, SELECTORS.balanceOf, pool),
          readUint(asset, SELECTORS.totalSupply),
          call(pool, SELECTORS.activeRules),
        ]);
      setState({
        status: "ready",
        error: null,
        data: {
          aspRoot, noteRoot, positions, registered, paused, owner, auditor,
          poolBalance, supply, rules: decodeRules(rulesHex),
        },
      });
    } catch (e) {
      setState((s) => ({ status: "error", data: s.data, error: (e as Error).message }));
    }
  }, [pool, asset]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}

export type ApassLookup =
  | { found: true; status: number; tier: string; subTier: number; group: string; subGroup: string;
      countries: string[]; expirationTime: number; cvRecordId: string; currentKycHash: string }
  | { found: false; code?: string; message?: string }
  | { error: string };

export function useEligibility(pool: string | undefined) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { address: string; onChain: boolean | null; apass: ApassLookup | null; error?: string } | null
  >(null);

  const check = useCallback(
    async (address: string) => {
      if (!pool) return;
      setBusy(true);
      setResult(null);
      try {
        // Both answers at once, because they are different questions. The chain says
        // whether this pool will admit the wallet; the registry says why.
        const [onChain, apass] = await Promise.all([
          readBool(pool, SELECTORS.isEligible, address).catch(() => null),
          fetch(`/api/apass?address=${address}`).then((r) => r.json() as Promise<ApassLookup>),
        ]);
        setResult({ address, onChain, apass });
      } catch (e) {
        setResult({ address, onChain: null, apass: null, error: (e as Error).message });
      } finally {
        setBusy(false);
      }
    },
    [pool],
  );

  return { busy, result, check, clear: () => setResult(null) };
}
