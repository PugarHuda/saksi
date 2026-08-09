export type Deployment = {
  chain?: string;
  chainId?: number;
  pool?: string;
  validator?: string;
  asset?: string;
  assetSymbol?: string;
  assetName?: string;
  assetDecimals?: number;
  atokenTx?: string;
  atokenRequestId?: string;
  issuer?: string;
  aspRoot?: string;
  aspAdmitted?: number;
  aspBuiltAt?: string;
  validatorRegisterTx?: string;
  verifiers?: Record<string, string>;
  auditor?: string;
  explorer?: string;
};

export type AspMember = {
  index: number;
  // Absent for members this project does not operate: the published set reduces them to
  // leaves, so every consumer must handle the missing address rather than assume it.
  wallet?: string;
  sourceKey: string;
  tier: string | number;
  countries: string[];
  cvRecordId?: string;
  currentKycHash?: string | null;
  label?: string | null;
};

export type SetChange = { wallet?: string; tier: string | number; label?: string | null };

export type AspSubject = {
  address: string;
  sourceKey: string;
  inSet: boolean;
  inPreviousSet: boolean;
};

export type Asp = {
  root: string;
  previousRoot?: string | null;
  levels: number;
  builtAt: string;
  admitted: number;
  populationQueried: number;
  dropped?: SetChange[];
  added?: SetChange[];
  rule: { minTier: number; countries: string[]; requireActive: boolean };
  subjects?: AspSubject[];
  members: AspMember[];
};

export type AuditEntry = {
  kind: "exact" | "threshold" | "range" | "aggregate";
  question: string;
  circuit: string;
  contextHash: string;
  answer: string;
  requestTx?: string;
  verifyTx?: string;
  // Optional: the ops scripts may record these. When they are absent the console derives
  // them from the transaction receipts, so the evidence screen never waits on the file.
  requestBlock?: number;
  verifyBlock?: number;
  verified: boolean;
  proveMs: number;
  at: string;
  // Set when an answer already on chain says less than its question implies. It cannot be
  // retracted, so every surface that shows the row has to show this beside it — an
  // uncorrected wrong answer on screen is worse than the original mistake.
  correction?: string;
};

export type Measurement = {
  chain: string;
  measuredAt: string;
  method: string;
  caveat: string;
  walletsEnumerated: number;
  assetsWithHolders: number;
  medianHolders: number;
  singleHolderAssets: number;
  assetsUnderFiveHolders: number;
  assetsWithDominantHolder: number;
  assets: { symbol: string; token: string; holders: number; topShare: number }[];
};

/** One leaf of the note tree, exactly as the chain describes it.
 *
 *  This used to be written from the operator's ledgers, which hold only positions that are
 *  still LIVE — spending one removes it. So the published bundle WAS the live set, and
 *  nothing else publishes that: a nullifier is Poseidon(commitment, leafIndex, privKey), so
 *  without the key it cannot be tied to the commitment it retires, and liveness is not
 *  otherwise derivable from the chain at all.
 *
 *  That single fact broke the register's central claim. Knowing which leaves are live gives
 *  you which are spent, every 2-in/2-out JoinSplit's inputs then follow by elimination, and
 *  with the spend graph fixed, conservation turns the public deposit amounts plus one
 *  disclosed figure into a solvable system. Run against this register it recovered 270.1 CVA
 *  on leaf 4 — an amount no audit ever disclosed — from public data alone.
 *
 *  Every field here is now read from `CommitmentInserted`, which the contract emits once per
 *  leaf for deposits and transfer outputs alike. Liveness is absent because it is not the
 *  chain's to give. */
export type Position = {
  commitment: string;
  leafIndex: number;
  tx: string;
  block: number;
  // A deposit emits Deposited in the same transaction; a transfer output does not. Public
  // either way, and it says nothing about whether the leaf is still live.
  origin: "deposit" | "transfer output";
};
