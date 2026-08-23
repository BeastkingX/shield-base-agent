import type {
  EvidenceItem,
  FiredRule,
  TargetType,
  Verdict,
} from "./scan-types";

export const RISK_ENGINE_VERSION = "0.1" as const;

interface RiskResult {
  verdict: Verdict;
  summary: string;
  rules: FiredRule[];
}

export function evaluateRisk(
  targetType: TargetType,
  evidence: EvidenceItem[],
): RiskResult {
  const rules: FiredRule[] = [];
  const dangerous = evidence.filter((item) => item.status === "danger");
  const warnings = evidence.filter((item) => item.status === "warning");
  const unavailable = evidence.filter((item) => item.status === "unavailable");

  if (dangerous.length > 0) {
    rules.push({
      id: "RULE_DANGEROUS_EVIDENCE",
      effect: "high-risk",
      explanation: "At least one completed check produced a high-risk signal.",
      evidenceIds: dangerous.map((item) => item.id),
    });

    return {
      verdict: "HIGH OBSERVED RISK",
      summary:
        "Shield found a strong risk signal. Review the cited evidence before interacting.",
      rules,
    };
  }

  if (warnings.length > 0) {
    rules.push({
      id: "RULE_WARNING_EVIDENCE",
      effect: "caution",
      explanation: "One or more completed checks produced a caution signal.",
      evidenceIds: warnings.map((item) => item.id),
    });

    return {
      verdict: "CAUTION",
      summary:
        "Shield found a condition that deserves review. A warning is not proof of malicious behavior.",
      rules,
    };
  }

  const deepEvidenceAvailable = evidence.some((item) =>
    [
      "EVIDENCE_CONTRACT_VERIFICATION",
      "EVIDENCE_ACTIVE_APPROVALS",
      "EVIDENCE_RECENT_ACTIVITY",
    ].includes(item.id) && item.status !== "unavailable",
  );

  if (!deepEvidenceAvailable) {
    rules.push({
      id: "RULE_BASELINE_ONLY",
      effect: "insufficient-data",
      explanation:
        "The baseline RPC scan completed, but indexed history and exposure checks were not available.",
      evidenceIds: unavailable.map((item) => item.id),
    });

    return {
      verdict: "INSUFFICIENT DATA",
      summary:
        targetType === "contract"
          ? "Shield classified the contract and captured live chain evidence, but deeper metadata is required for a risk conclusion."
          : "Shield classified the wallet and captured live chain evidence, but balance and transaction count alone cannot establish trust.",
      rules,
    };
  }

  return {
    verdict: "LOW OBSERVED RISK",
    summary:
      "No serious signal was found by the checks that completed. This is not a guarantee of safety.",
    rules,
  };
}
