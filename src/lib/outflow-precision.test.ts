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
 * Mirrors evidence claim generation for warning case in scan-agent.ts after precision fix
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
  sweepDestination: string;
}): { label: string; claim: string; facts: Record<string, string | number> } {
  const isRecentOnly = cluster.recentRapidForwarding && !cluster.isSweeperActive;
  if (isRecentOnly) {
    const recent = cluster.recentDeltas || [];
    const median = cluster.sweepVelocitySeconds;
    const recentStr = recent.length ? recent.map((s) => `${s}s`).join(" and ") : "unknown";
    const medianStr = median !== null ? `${median}s` : "unknown";
    return {
      label: "Recent rapid forwarding measured (unattributed)",
      claim: `Recent deposits were forwarded in ${recentStr} (recent rapid forwarding), while the lifetime median across ${cluster.velocitySamples} sample(s) is ${medianStr}. This indicates a recent behavioral change versus the longer history. No dispenser-funder or aggregation-hub pattern was measured. Legitimate services (e.g. exchange deposit wallets) can show the same shape.`,
      facts: {
        "Recent deltas (s)": recent.join(", "),
        "Lifetime median (s)": medianStr,
        "Velocity samples": cluster.velocitySamples,
      },
    };
  } else {
    return {
      label: cluster.isSweeperActive
        ? "Automated forwarding measured (unattributed)"
        : "Recent rapid forwarding measured (unattributed)",
      claim: cluster.isSweeperActive
        ? `Deposits are forwarded quickly (median ${cluster.sweepVelocitySeconds}s over ${cluster.velocitySamples} sample(s)), but no dispenser-funder or aggregation-hub pattern was measured.`
        : `Recent rapid forwarding was measured (recent deltas ${cluster.recentDeltas.join("s and ")}s, lifetime median ${cluster.sweepVelocitySeconds}s over ${cluster.velocitySamples} sample(s)). No dispenser-funder or aggregation-hub pattern was measured.`,
      facts: {},
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
});
