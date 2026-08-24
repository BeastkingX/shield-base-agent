export type EvidenceStatus =
  | "pass"
  | "warning"
  | "danger"
  | "info"
  | "unavailable";

export type Verdict =
  | "LOW OBSERVED RISK"
  | "CAUTION"
  | "HIGH OBSERVED RISK"
  | "INSUFFICIENT DATA";

export type TargetType = "wallet" | "contract";

export type EvidenceCategory =
  | "chain"
  | "identity"
  | "history"
  | "exposure"
  | "community";

export type EvidenceFactValue = string | number | boolean | null;

export interface EvidenceItem {
  id: string;
  category: EvidenceCategory;
  label: string;
  status: EvidenceStatus;
  claim: string;
  source: string;
  method: string;
  blockNumber: string;
  observedAt: string;
  rawValue: string | number | boolean | null;
  facts?: Record<string, EvidenceFactValue>;
  explorerUrl: string;
  referenceUrl?: string;
  limitations: string[];
}

export interface FiredRule {
  id: string;
  effect:
    | "low-observed-risk"
    | "caution"
    | "high-risk"
    | "insufficient-data";
  explanation: string;
  evidenceIds: string[];
}

export interface ScanReceipt {
  receiptId: string;
  receiptVersion: "0.1";
  riskEngineVersion: "0.1" | "0.2";
  network: "Base Mainnet";
  chainId: 8453;
  address: string;
  targetType: TargetType;
  blockNumber: string;
  blockTimestamp: string;
  scannedAt: string;
  verdict: Verdict;
  summary: string;
  coverage: {
    completed: number;
    unavailable: number;
    total: number;
  };
  evidence: EvidenceItem[];
  firedRules: FiredRule[];
  limitations: string[];
}
