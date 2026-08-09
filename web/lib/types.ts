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

export type Position = {
  commitment: string;
  depositTx?: string;
  provedAt: string;
  // null on anything that did not enter through deposit(): a JoinSplit output was admitted
  // under no root at all. Typed as nullable so the compiler catches a deref rather than the
  // browser — `short(null)` threw and took the whole Register tab down with it.
  aspRoot: string | null;
  // How the commitment came to exist: "deposit", or a JoinSplit output — "transact" for the
  // sender's change and "received" for the recipient's note. Neither JoinSplit output carries
  // an association-set proof or an entry transaction, so neither may be rendered as one.
  // Absent on older bundles, where every row was a deposit.
  origin?: "deposit" | "transact" | "received";
};
