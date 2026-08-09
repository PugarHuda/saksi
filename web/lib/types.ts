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

export type Position = {
  commitment: string;
  depositTx?: string;
  provedAt: string;
  aspRoot: string;
  // "transact" = an output of a shielded transfer, not a deposit. Such a commitment carries
  // no association-set proof and no entry transaction, so it must not be rendered as one.
  // Absent on older bundles, which is why every read of it is optional.
  origin?: string;
};
