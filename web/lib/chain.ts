// Minimal eth_call client. The console reads the pool and Cleanverse's Validator
// directly from Monad rather than from a cached index, so what a user is shown is what
// the chain will do — the same promise the pool's isEligible() view exists to keep.
//
// ponytail: hand-rolled ABI encoding for four call shapes beats pulling a web3 library
// in for them. Add viem the moment a fifth shape needs decoding.

export const RPC = process.env.NEXT_PUBLIC_RPC ?? "https://testnet-rpc.monad.xyz";
export const EXPLORER =
  process.env.NEXT_PUBLIC_EXPLORER ?? "https://testnet.monadexplorer.com";

/** keccak-256 of the signature, first 4 bytes — precomputed so the client ships no hasher. */
export const SELECTORS = {
  aspRoot: "0xd4401eaa",
  noteRoot: "0xaec543b9",
  commitmentCount: "0xc44956d1",
  registeredWithValidator: "0x612f004d",
  activeRules: "0x3f88b03e",
  paused: "0x5c975abb",
  owner: "0x8da5cb5b",
  auditor: "0x3ec045a6",
  balanceOf: "0x70a08231",
  isEligible: "0x66e305fd",
  totalSupply: "0x18160ddd",
  // The pool derives the association-set leaf for an address itself, so the console can
  // ask what a wallet's leaf is without shipping a keccak implementation to the browser.
  sourceKeyOf: "0x49d3f9aa",
  getDenyList: "0xd1329f0e",
} as const;

/** complianceVerify(address,address) on Cleanverse's Validator — their contract, not ours. */
export const COMPLIANCE_VERIFY = "0xaf375463";

/** Two address arguments, ABI-encoded. */
export const pad2 = (a: string, b: string) =>
  a.replace(/^0x/, "").toLowerCase().padStart(64, "0") +
  b.replace(/^0x/, "").toLowerCase().padStart(64, "0");

/** getDenyList() returns uint256[8] — a fixed array, so no offset word. */
export function decodeDenyList(hex: string): bigint[] {
  const body = hex.replace(/^0x/, "");
  const out: bigint[] = [];
  for (let i = 0; i < 8 && (i + 1) * 64 <= body.length; i++) {
    out.push(BigInt("0x" + body.slice(i * 64, (i + 1) * 64)));
  }
  return out;
}

export type RuleV2 = {
  allowedGroup: string;
  allowedSubGroup: string;
  minTier: number;
  minSubTier: number;
  isBlackList: boolean;
  countryBitmap: bigint;
};

/** activeRules() returns RuleV2[] — a dynamic array of SIX-word static structs. Cleanverse
 *  published the missing isBlackList field on 9 Aug; decoding five words read the wrong
 *  slot as the country bitmap, which only looked correct because both were zero. */
export function decodeRules(hex: string): RuleV2[] {
  const body = hex.replace(/^0x/, "");
  if (body.length < 128) return [];
  const word = (i: number) => body.slice(i * 64, i * 64 + 64);
  const count = Number(BigInt("0x" + word(1)));
  const rules: RuleV2[] = [];
  for (let i = 0; i < count; i++) {
    const at = 2 + i * 6;
    rules.push({
      allowedGroup: "0x" + word(at).slice(0, 4),
      allowedSubGroup: "0x" + word(at + 1).slice(0, 4),
      minTier: Number(BigInt("0x" + word(at + 2))),
      minSubTier: Number(BigInt("0x" + word(at + 3))),
      isBlackList: BigInt("0x" + word(at + 4)) === 1n,
      countryBitmap: BigInt("0x" + word(at + 5)),
    });
  }
  return rules;
}

async function rpc(method: string, params: unknown[]): Promise<string> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message ?? "rpc error");
  return body.result as string;
}

const pad = (addr: string) => addr.replace(/^0x/, "").toLowerCase().padStart(64, "0");

export async function call(to: string, data: string): Promise<string> {
  return rpc("eth_call", [{ to, data }, "latest"]);
}

export async function readUint(to: string, selector: string, arg?: string): Promise<bigint> {
  const out = await call(to, selector + (arg ? pad(arg) : ""));
  return BigInt(out === "0x" ? "0x0" : out);
}

export async function readBool(to: string, selector: string, arg?: string): Promise<boolean> {
  return (await readUint(to, selector, arg)) === 1n;
}

export async function readAddress(to: string, selector: string): Promise<string> {
  const out = await call(to, selector);
  return "0x" + out.slice(-40);
}

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;

export const short = (s: string, head = 8, tail = 6) =>
  s.length <= head + tail + 2 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;

/** 6-decimal fixed point, grouped. Amounts that are shielded never reach this. */
export const units = (v: bigint, decimals = 6) => {
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole.toLocaleString("en-US")}.${frac}` : whole.toLocaleString("en-US");
};
