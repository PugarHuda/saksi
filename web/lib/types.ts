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
  explorer?: string;
};

export type AspMember = {
  index: number;
  wallet: string;
  sourceKey: string;
  tier: string | number;
  countries: string[];
  cvRecordId?: string;
  currentKycHash?: string | null;
  label?: string | null;
};

export type SetChange = { wallet: string; tier: string | number; label?: string | null };

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
};
