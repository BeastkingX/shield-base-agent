import type {
  EvidenceItem,
  FiredRule,
  TargetType,
  Verdict,
} from "./scan-types";

export const RISK_ENGINE_VERSION = "0.3" as const;

interface RiskResult {
  verdict: Verdict;
  summary: string;
  rules: FiredRule[];
}

const CONTRACT_REQUIRED_EVIDENCE = [
  "EVIDENCE_CONTRACT_VERIFICATION",
  "EVIDENCE_CONTRACT_CREATION",
  "EVIDENCE_RECENT_ACTIVITY",
];

const WALLET_REQUIRED_EVIDENCE = [
  "EVIDENCE_RECENT_ACTIVITY",
  "EVIDENCE_ACTIVE_APPROVALS",
];

export function evaluateRisk(
  targetType: TargetType,
  evidence: EvidenceItem[],
): RiskResult {
  const rules: FiredRule[] = [];
  const dangerous = evidence.filter((item) => item.status === "danger");
  const warnings = evidence.filter((item) => item.status === "warning");

  // Check for sweeper bot / compromised wallet
  const sweeperEvidence = evidence.find((item) => item.id === "EVIDENCE_SWEEPER_BOT_ANALYSIS" && item.status === "danger");
  if (sweeperEvidence) {
    rules.push({
      id: "RULE_COMPROMISED_SWEEPER_DETECTED",
      effect: "high-risk",
      explanation: "Wallet exhibits rapid automated sweep behavior (<30s). Private key is likely compromised.",
      evidenceIds: [sweeperEvidence.id],
    });

    return {
      verdict: "HIGH OBSERVED RISK",
      summary: "DO NOT SEND FUNDS: This recipient has an active SWEEPER BOT. Any gas or tokens sent here will be stolen within seconds.",
      rules,
    };
  }

  // Check for drainer cluster taint
  const clusterEvidence = evidence.find((item) => item.id === "EVIDENCE_MONEY_TRAIL_CLUSTER" && item.status === "danger");
  if (clusterEvidence) {
    rules.push({
      id: "RULE_CRITICAL_DRAINER_DETECTED",
      effect: "high-risk",
      explanation: "Target address or its seed gas funder matches known malicious drainer signatures or cluster hubs.",
      evidenceIds: [clusterEvidence.id],
    });

    return {
      verdict: "HIGH OBSERVED RISK",
      summary: "Shield found a direct link to known phishing drainer infrastructure. Do not interact.",
      rules,
    };
  }

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

  const requiredEvidence =
    targetType === "contract"
      ? CONTRACT_REQUIRED_EVIDENCE
      : WALLET_REQUIRED_EVIDENCE;
  const missingRequiredEvidence = requiredEvidence.filter((id) => {
    const item = evidence.find((candidate) => candidate.id === id);
    return !item || item.status === "unavailable";
  });

  if (missingRequiredEvidence.length > 0) {
    rules.push({
      id: "RULE_REQUIRED_EVIDENCE_MISSING",
      effect: "insufficient-data",
      explanation:
        "One or more evidence categories required for a low-observed-risk conclusion were unavailable.",
      evidenceIds: missingRequiredEvidence,
    });

    return {
      verdict: "INSUFFICIENT DATA",
      summary:
        targetType === "contract"
          ? "Shield captured live chain evidence, but source, deployment-provenance, or recent-activity evidence is missing. The scan cannot support a low-risk conclusion."
          : "Shield captured live chain evidence, but recent activity or approval exposure is missing. The scan cannot establish trust.",
      rules,
    };
  }

  rules.push({
    id: "RULE_NO_ADVERSE_SIGNALS",
    effect: "low-observed-risk",
    explanation:
      "The required checks completed and did not produce a warning or danger signal.",
    evidenceIds: requiredEvidence,
  });

  return {
    verdict: "LOW OBSERVED RISK",
    summary:
      "No serious signal was found by the required checks. This is limited to observed evidence and is not a guarantee of safety.",
    rules,
  };
}
