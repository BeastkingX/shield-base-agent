import { describe, it, expect } from "vitest";

/**
 * Mirrors outflowStat logic from src/app/page.tsx after precision fix.
 * For recentRapidForwarding true but isSweeperActive false:
 * - qualifier must be "(fast-forwarding)" not "(clean)"
 * - warning color
 * - fastest recent delta used for value
 */
function computeOutflowStat(cluster: {
  analysisStatus: "completed" | "partial" | "unavailable";
  sweepVelocitySeconds: number | null;
  isSweeperActive: boolean;
  recentRapidForwarding: boolean;
  recentDeltas: number[];
}): { value: string; tag: string; tone: "danger" | "safe" | "muted" | "warning" } {
  if (!cluster || cluster.analysisStatus === "unavailable") {
    return { value: "—", tag: "history unavailable", tone: "muted" };
  }

  const seconds = cluster.sweepVelocitySeconds;
  const recentRapid = cluster.recentRapidForwarding === true;
  const isSweeper = cluster.isSweeperActive === true;

  if (recentRapid && !isSweeper) {
    const recentDeltas = cluster.recentDeltas || [];
    const fastestRecent =
      recentDeltas.length > 0 ? Math.min(...recentDeltas) : typeof seconds === "number" ? seconds : null;

    let value: string;
    if (fastestRecent === null) value = "—";
    else if (fastestRecent < 60) value = `${fastestRecent}s`;
    else if (fastestRecent < 3600) value = `${Math.round(fastestRecent / 60)}m`;
    else if (fastestRecent < 86400) value = `${(fastestRecent / 3600).toFixed(1)}h`;
    else value = `${Math.round(fastestRecent / 86400)}d`;

    return { value, tag: "fast-forwarding", tone: "warning" };
  }

  if (typeof seconds === "number") {
    const fastForwarding = seconds <= 120 || isSweeper;
    let value: string;
    if (seconds < 60) value = `${seconds}s`;
    else if (seconds < 3600) value = `${Math.round(seconds / 60)}m`;
    else if (seconds < 86400) value = `${(seconds / 3600).toFixed(1)}h`;
    else value = `${Math.round(seconds / 86400)}d`;

    return {
      value,
      tag: fastForwarding
        ? "fast-forwarding"
        : cluster.analysisStatus === "partial"
          ? "clean · partial data"
          : "clean",
      tone: fastForwarding ? "danger" : "safe",
    };
  }

  if (isSweeper) {
    return { value: "<8s", tag: "fast-forwarding", tone: "danger" };
  }

  return {
    value: "—",
    tag:
      cluster.analysisStatus === "partial"
        ? "no forward measured · partial data"
        : "no forward measured",
    tone: "muted",
  };
}

/**
 * Mirrors evidence claim generation for warning case in scan-agent.ts after
 * the precision fix AND the 2-hop honesty fix: the claim must state a measured
 * dispenser/hub pattern instead of denying it, and only deny when none was
 * measured.
 */
function buildMoneyTrailWarningClaim(cluster: {
  sweepVelocitySeconds: number | null;
  velocitySamples: number;
  recentDeltas: number[];
  recentRapidForwarding: boolean;
  isSweeperActive: boolean;
  seedFunder: string;
  funderProfile: string;
  hubProfile: string;
  hop2Funder?: string | null;
  sweepDestination: string;
}): { label: string; claim: string; facts: Record<string, string | number> } {
  const dispenserMeasured = cluster.funderProfile.startsWith("Gas-dispenser pattern");
  const hubMeasured = cluster.hubProfile.startsWith("Consolidation-hub pattern");
  const patternSentence = dispenserMeasured
    ? `A gas-dispenser seed funder was measured: ${cluster.funderProfile} The seed funder was itself first funded by ${cluster.hop2Funder ?? "not observed in the read window"} (hop-2).`
    : hubMeasured
      ? `A consolidation-hub outflow destination was measured: ${cluster.hubProfile}`
      : "No dispenser-funder or aggregation-hub pattern was measured.";
  const isRecentOnly = cluster.recentRapidForwarding && !cluster.isSweeperActive;
  if (isRecentOnly) {
    const recent = cluster.recentDeltas || [];
    const median = cluster.sweepVelocitySeconds;
    const recentStr = recent.length ? recent.map((s) => `${s}s`).join(" and ") : "unknown";
    const medianStr = median !== null ? `${median}s` : "unknown";
    return {
      label: "Recent rapid forwarding measured (unattributed)",
      claim: `Recent deposits were forwarded in ${recentStr} (recent rapid forwarding), while the lifetime median across ${cluster.velocitySamples} sample(s) is ${medianStr}. This indicates a recent behavioral change versus the longer history. ${patternSentence} Legitimate services (e.g. exchange deposit wallets) can show the same shape.`,
      facts: {
        "Recent deltas (s)": recent.join(", "),
        "Lifetime median (s)": medianStr,
        "Velocity samples": cluster.velocitySamples,
        "Seed funder": cluster.seedFunder,
        "Funder profile": cluster.funderProfile,
        "Hop-2 funder": cluster.hop2Funder ?? "not observed",
        "Hub profile": cluster.hubProfile,
      },
    };
  } else {
    return {
      label: cluster.isSweeperActive
        ? dispenserMeasured
          ? "Automated forwarding measured, seed funder is a gas dispenser"
          : "Automated forwarding measured (unattributed)"
        : "Recent rapid forwarding measured (unattributed)",
      claim: cluster.isSweeperActive
        ? `Deposits are forwarded quickly (median ${cluster.sweepVelocitySeconds}s over ${cluster.velocitySamples} sample(s)). ${patternSentence} Fast forwarding alone does not prove malicious intent, but a dispenser-funded wallet forwarding deposits within seconds matches measured burner-wallet infrastructure. Legitimate services (e.g. exchange deposit wallets) can show the same forwarding speed.`
        : `Recent rapid forwarding was measured (recent deltas ${cluster.recentDeltas.join("s and ")}s, lifetime median ${cluster.sweepVelocitySeconds}s over ${cluster.velocitySamples} sample(s)). ${patternSentence} Legitimate services can show the same shape.`,
      facts: {
        "Median forward time (s)": cluster.sweepVelocitySeconds as number,
        "Recent deltas (s)": cluster.recentDeltas.join(", "),
        "Samples": cluster.velocitySamples,
        "Top outflow destination": cluster.sweepDestination,
        "Seed funder": cluster.seedFunder,
        "Funder profile": cluster.funderProfile,
        "Hop-2 funder": cluster.hop2Funder ?? "not observed",
        "Hub profile": cluster.hubProfile,
      },
    };
  }
}

describe("outflow stat precision fix", () => {
  it("recentRapidForwarding true but isSweeperActive false → (fast-forwarding) with warning tone", () => {
    const cluster = {
      analysisStatus: "completed" as const,
      sweepVelocitySeconds: 116681,
      isSweeperActive: false,
      recentRapidForwarding: true,
      recentDeltas: [598, 20],
    };

    const stat = computeOutflowStat(cluster);
    expect(stat.tag).toBe("fast-forwarding");
    expect(stat.tone).toBe("warning");
    expect(stat.tag).not.toBe("clean");
    // fastest recent is 20s
    expect(stat.value).toBe("20s");
  });

  it("lifetime median 116681s alone (no recent rapid) → clean, not fast-forwarding", () => {
    const cluster = {
      analysisStatus: "completed" as const,
      sweepVelocitySeconds: 116681,
      isSweeperActive: false,
      recentRapidForwarding: false,
      recentDeltas: [116681, 120000],
    };

    const stat = computeOutflowStat(cluster);
    expect(stat.tag).toBe("clean");
    expect(stat.tone).toBe("safe");
  });

  it("isSweeperActive true → fast-forwarding with danger tone", () => {
    const cluster = {
      analysisStatus: "completed" as const,
      sweepVelocitySeconds: 6,
      isSweeperActive: true,
      recentRapidForwarding: true,
      recentDeltas: [6, 5],
    };

    const stat = computeOutflowStat(cluster);
    expect(stat.tag).toBe("fast-forwarding");
    expect(stat.tone).toBe("danger");
  });

  it("isSweeperActive false → no automated wording in label/claim", () => {
    const cluster = {
      sweepVelocitySeconds: 116681,
      velocitySamples: 5,
      recentDeltas: [598, 20],
      recentRapidForwarding: true,
      isSweeperActive: false,
      seedFunder: "0xabc",
      funderProfile: "No dispenser pattern measured",
      hubProfile: "No aggregator pattern",
      sweepDestination: "0xdef",
    };

    const { label, claim } = buildMoneyTrailWarningClaim(cluster);
    expect(label.toLowerCase()).not.toContain("automated");
    expect(label.toLowerCase()).toContain("recent rapid");
    expect(claim.toLowerCase()).not.toContain("automated");
    expect(claim.toLowerCase()).toContain("recent rapid forwarding");
  });

  it("lifetime median and recent deltas shown accurately for wallet with 598s and 20s vs 116681s median", () => {
    const cluster = {
      sweepVelocitySeconds: 116681,
      velocitySamples: 5,
      recentDeltas: [598, 20],
      recentRapidForwarding: true,
      isSweeperActive: false,
      seedFunder: "0xabc",
      funderProfile: "No dispenser pattern measured",
      hubProfile: "No aggregator pattern",
      sweepDestination: "0xdef",
    };

    const { claim, facts } = buildMoneyTrailWarningClaim(cluster);

    // Must NOT describe 116681s as "forwarded quickly"
    expect(claim).not.toMatch(/forwarded quickly.*116681/);
    expect(claim).not.toContain("Deposits are forwarded quickly (median 116681");

    // Must explain distinction
    expect(claim).toContain("598s");
    expect(claim).toContain("20s");
    expect(claim).toContain("116681s");
    expect(claim).toContain("lifetime median");
    expect(claim).toContain("recent");

    // Facts accurate
    expect(facts["Recent deltas (s)"]).toBe("598, 20");
    expect(facts["Lifetime median (s)"]).toBe("116681s");

    // Keep honest statement about no dispenser/hub pattern
    expect(claim).toContain("No dispenser-funder or aggregation-hub pattern was measured");
  });

  it("does not invent dispenser-funder pattern when none measured", () => {
    const cluster = {
      sweepVelocitySeconds: 116681,
      velocitySamples: 5,
      recentDeltas: [598, 20],
      recentRapidForwarding: true,
      isSweeperActive: false,
      seedFunder: "0xabc",
      funderProfile: "No dispenser pattern measured",
      hubProfile: "No aggregator pattern",
      sweepDestination: "0xdef",
    };

    const { claim } = buildMoneyTrailWarningClaim(cluster);
    expect(claim).toContain("No dispenser-funder or aggregation-hub pattern was measured");
  });

  it("measured gas-dispenser funder: claim states the pattern + hop-2 instead of denying it", () => {
    const cluster = {
      sweepVelocitySeconds: 22,
      velocitySamples: 3,
      recentDeltas: [30, 22, 6],
      recentRapidForwarding: true,
      isSweeperActive: true,
      seedFunder: "0x3d66f034867a2cebd9be7cca4b0cb4b22ce27d6c",
      funderProfile:
        "Gas-dispenser pattern (measured): 20 distinct addresses funded with <=0.0005 ETH each.",
      hubProfile: "No aggregator pattern",
      hop2Funder: "0xa7c6c7c02186a8ecf5229a59eb2a3cfb7f45e6ed",
      sweepDestination: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    };

    const { label, claim, facts } = buildMoneyTrailWarningClaim(cluster);

    // Label surfaces the measured dispenser (headline evidence for the 2-hop story)
    expect(label).toContain("gas dispenser");

    // Claim states the measured pattern, the count, and hop-2
    expect(claim).toContain("A gas-dispenser seed funder was measured");
    expect(claim).toContain("20 distinct addresses");
    expect(claim).toContain("(hop-2)");
    expect(claim).toContain("0xa7c6c7c02186a8ecf5229a59eb2a3cfb7f45e6ed");

    // Must NOT deny the pattern that was measured
    expect(claim).not.toContain("No dispenser-funder or aggregation-hub pattern was measured");

    // Facts expose the full trail
    expect(facts["Seed funder"]).toBe("0x3d66f034867a2cebd9be7cca4b0cb4b22ce27d6c");
    expect(String(facts["Funder profile"])).toContain("Gas-dispenser pattern");
    expect(facts["Hop-2 funder"]).toBe("0xa7c6c7c02186a8ecf5229a59eb2a3cfb7f45e6ed");
  });

  it("recent-only warning with measured dispenser: denial sentence is replaced", () => {
    const cluster = {
      sweepVelocitySeconds: 116681,
      velocitySamples: 5,
      recentDeltas: [598, 20],
      recentRapidForwarding: true,
      isSweeperActive: false,
      seedFunder: "0xabc",
      funderProfile:
        "Gas-dispenser pattern (measured): 9 distinct addresses funded with <=0.0005 ETH each.",
      hubProfile: "No aggregator pattern",
      hop2Funder: "0x1234",
      sweepDestination: "0xdef",
    };

    const { claim } = buildMoneyTrailWarningClaim(cluster);
    expect(claim).toContain("A gas-dispenser seed funder was measured");
    expect(claim).toContain("(hop-2)");
    expect(claim).not.toContain("No dispenser-funder or aggregation-hub pattern was measured");
  });
});
