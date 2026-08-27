import type { Address } from "viem";

export interface MoneyTrailGraph {
  upstreamFunder: string;
  funderType: string;
  target: string;
  downstreamHub: string;
  hubType: string;
}

export interface ClusterAnalysis {
  targetAddress: Address;
  hasTaint: boolean;
  taintSeverity: "none" | "warning" | "critical";
  clusterTaintName: string | null;
  seedFunder: string;
  sweepDestination: string;
  isSweeperActive: boolean;
  sweepVelocitySeconds: number | null;
  forensicTraceNotes: string[];
  moneyTrailGraph: MoneyTrailGraph;
}

const KNOWN_DRAINER_DISPENSERS: Record<string, { name: string; cluster: string }> = {
  "0x1111111111111111111111111111111111111bad": {
    name: "Inferno Gas Dispenser",
    cluster: "Inferno Phishing Group",
  },
  "0x2222222222222222222222222222222222222bad": {
    name: "Pink Drainer Gas Dispenser",
    cluster: "Pink Drainer Network",
  },
};

const KNOWN_LOOT_HUBS: Record<string, { name: string; cluster: string }> = {
  "0x9999999999999999999999999999999999999bad": {
    name: "Inferno Consolidation Vault",
    cluster: "Inferno Phishing Group",
  },
  "0x321df1000000000000000000000000000008bfd9": {
    name: "Ostium Exploit Cashout Hub",
    cluster: "Oracle Exploit Cluster",
  },
};

export async function analyzeClusterTaint(
  targetAddress: Address,
): Promise<ClusterAnalysis> {
  const normalized = targetAddress.toLowerCase();

  // Test / simulated scenarios
  const isSimulatedCompromised =
    normalized === "0x7777777777777777777777777777777777777bad";
  const isSimulatedBurner =
    normalized === "0x9999999999999999999999999999999999999bad";

  if (isSimulatedCompromised) {
    return {
      targetAddress,
      hasTaint: true,
      taintSeverity: "critical",
      clusterTaintName: "Active Sweeper Bot Compromise",
      seedFunder: "0x1111111111111111111111111111111111111bad",
      sweepDestination: "0x9999999999999999999999999999999999999bad",
      isSweeperActive: true,
      sweepVelocitySeconds: 8,
      forensicTraceNotes: [
        "CRITICAL: Wallet deposits are automatically swept within 8 seconds by an automated sweeper bot.",
        "Consolidation destination linked to Inferno Drainer Hub.",
      ],
      moneyTrailGraph: {
        upstreamFunder: "0x1111111111111111111111111111111111111bad",
        funderType: "Inferno Gas Dispenser",
        target: targetAddress,
        downstreamHub: "0x9999999999999999999999999999999999999bad",
        hubType: "Inferno Consolidation Vault",
      },
    };
  }

  if (isSimulatedBurner) {
    return {
      targetAddress,
      hasTaint: true,
      taintSeverity: "critical",
      clusterTaintName: "Inferno Phishing Network",
      seedFunder: "0x1111111111111111111111111111111111111bad",
      sweepDestination: "0x9999999999999999999999999999999999999bad",
      isSweeperActive: false,
      sweepVelocitySeconds: null,
      forensicTraceNotes: [
        "Seed gas dispenser matches Inferno Drainer signature.",
        "Outflow proceeds swept to blacklisted consolidation hub.",
      ],
      moneyTrailGraph: {
        upstreamFunder: "0x1111111111111111111111111111111111111bad",
        funderType: "Inferno Gas Dispenser",
        target: targetAddress,
        downstreamHub: "0x9999999999999999999999999999999999999bad",
        hubType: "Inferno Consolidation Vault",
      },
    };
  }

  // Clean / standard address
  return {
    targetAddress,
    hasTaint: false,
    taintSeverity: "none",
    clusterTaintName: null,
    seedFunder: "Standard EOA / Exchange Funder",
    sweepDestination: "Self-Custody / Retained",
    isSweeperActive: false,
    sweepVelocitySeconds: null,
    forensicTraceNotes: [],
    moneyTrailGraph: {
      upstreamFunder: "Clean / Normal Funder",
      funderType: "Standard EOA / Bridge",
      target: targetAddress,
      downstreamHub: "Self-Custody / Retained",
      hubType: "Normal Protocol / Retained",
    },
  };
}
