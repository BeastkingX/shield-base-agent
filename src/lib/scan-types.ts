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

export interface EvidenceItem {
  id: string;
  label: string;
  status: EvidenceStatus;
  claim: string;
  source: string;
  method: string;
  blockNumber: string;
  observedAt: string;
  rawValue: string | number | boolean | null;
  explorerUrl: string;
  limitations: string[];
}

export interface FiredRule {
  id: string;
  effect: "caution" | "high-risk" | "insufficient-data";
  explanation: string;
  evidenceIds: string[];
}

export interface ScanReceipt {
  receiptId: string;
  receiptVersion: "0.1";
  riskEngineVersion: "0.1";
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
