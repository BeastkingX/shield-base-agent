import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeClusterTaint } from "./cluster-detector";

/**
 * Fixtures model the exact order of explorer calls made by analyzeClusterTaint:
 *   1. target txlist ascending (genesis side)
 *   2. target txlist descending (recent side)
 *   3. seed-funder txlist ascending   (only when an inbound funder exists)
 *   4. dominant-hub txlist descending (only when outbound >= 3)
 * The mock keys responses by `address` + `sort` taken from the request URL.
 */

interface FixtureTx {
  hash: string;
  from: string;
  to: string;
  value: string; // wei, as decimal string (explorer format)
  timeStamp: string; // unix seconds
  isError?: string;
  txreceipt_status?: string;
  methodId?: string;
  functionName?: string;
}

let n = 0;
function tx(partial: Partial<FixtureTx> & Pick<FixtureTx, "from" | "to" | "timeStamp">): FixtureTx {
  n += 1;
  return {
    hash: `0xhash${n.toString().padStart(4, "0")}`,
    value: "0",
    isError: "0",
    txreceipt_status: "1",
    methodId: "0x",
    functionName: "",
    ...partial,
  };
}

const ETH = (ether: number) => BigInt(Math.round(ether * 1e18)).toString();

function mockExplorer(fixtures: Record<string, Record<string, FixtureTx[]>>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const address = (url.searchParams.get("address") ?? "").toLowerCase();
    const sort = url.searchParams.get("sort") ?? "asc";
    const rows = fixtures[address]?.[sort] ?? [];
    return new Response(
      JSON.stringify({ status: "1", message: "OK", result: rows }),
      { status: 200 },
    );
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("analyzeClusterTaint (real measurement engine)", () => {
  const TARGET = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const FUNDER = "0xf00000000000000000000000000000000000000d";
  const HOP2 = "0xf00000000000000000000000000000000000009e";
  const HUB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  it("detects a measured sweeper: deposit-to-forward median, dispenser funder, aggregation hub", async () => {
    const history = [
      tx({ from: FUNDER, to: TARGET, value: ETH(0.0005), timeStamp: "1000" }),
      tx({ from: "0x1111111111111111111111111111111111111111", to: TARGET, value: ETH(0.01), timeStamp: "2000" }),
      tx({ from: TARGET, to: HUB, value: ETH(0.01), timeStamp: "2006" }),
      tx({ from: "0x2222222222222222222222222222222222222222", to: TARGET, value: ETH(0.01), timeStamp: "3000" }),
      tx({ from: TARGET, to: HUB, value: ETH(0.01), timeStamp: "3006" }),
      tx({ from: "0x3333333333333333333333333333333333333333", to: TARGET, value: ETH(0.01), timeStamp: "4000" }),
      tx({ from: TARGET, to: HUB, value: ETH(0.01), timeStamp: "4006" }),
    ];
    const funderHistory = [
      tx({ from: HOP2, to: FUNDER, value: ETH(1), timeStamp: "1" }),
      ...Array.from({ length: 9 }, (_, i) =>
        tx({ from: FUNDER, to: `0x${(i + 1).toString(16).padStart(40, "0")}`, value: ETH(0.0004), timeStamp: String(10 + i) }),
      ),
    ];
    const hubHistory = Array.from({ length: 10 }, (_, i) =>
      tx({ from: `0xabc${i.toString(16)}000000000000000000000000000000000000`, to: HUB, value: ETH(0.01), timeStamp: String(5000 + i) }),
    );

    vi.stubGlobal("fetch", mockExplorer({
      [TARGET]: { asc: history, desc: [...history].reverse() },
      [FUNDER]: { asc: funderHistory },
      [HUB]: { desc: hubHistory },
    }));

    const result = await analyzeClusterTaint(TARGET as `0x${string}`);

    expect(result.taintSeverity).toBe("critical");
    expect(result.hasTaint).toBe(true);
    expect(result.isSweeperActive).toBe(true);
    // Deltas: 1000->2006 (1006s), then 6s, 6s, 6s => median 6.
    expect(result.sweepVelocitySeconds).toBe(6);
    expect(result.velocitySamples).toBe(4);
    expect(result.seedFunder.toLowerCase()).toBe(FUNDER);
    expect(result.sweepDestination.toLowerCase()).toBe(HUB);
    expect(result.hop2Funder?.toLowerCase()).toBe(HOP2);
    expect(result.funderProfile).toContain("Gas-dispenser");
    expect(result.hubProfile).toContain("Consolidation-hub");
    expect(result.analysisStatus).toBe("completed");
    expect(result.forensicTraceNotes.join(" ")).toContain("median 6s");
  });

  it("returns 'none' with honest notes for a normal wallet with slow, self-paced transfers", async () => {
    const EXCHANGE = "0xcccccccccccccccccccccccccccccccccccccccc";
    const history = [
      tx({ from: EXCHANGE, to: TARGET, value: ETH(0.5), timeStamp: "1000" }),
      tx({ from: TARGET, to: EXCHANGE, value: ETH(0.1), timeStamp: "90000" }),
    ];
    const funderHistory = [
      tx({ from: EXCHANGE, to: "0xdddddddddddddddddddddddddddddddddddddddd", value: ETH(2), timeStamp: "3" }),
      tx({ from: EXCHANGE, to: TARGET, value: ETH(0.5), timeStamp: "1000" }),
    ];

    vi.stubGlobal("fetch", mockExplorer({
      [TARGET]: { asc: history, desc: [...history].reverse() },
      [EXCHANGE]: { asc: funderHistory },
    }));

    const result = await analyzeClusterTaint(TARGET as `0x${string}`);

    expect(result.hasTaint).toBe(false);
    expect(result.taintSeverity).toBe("none");
    expect(result.isSweeperActive).toBe(false);
    expect(result.analysisStatus).toBe("completed");
    expect(result.forensicTraceNotes.join(" ")).toContain("Too few deposit/forward pairs");
    expect(result.forensicTraceNotes.join(" ")).toContain("No rapid-forwarding");
  });

  it("is honest about a fresh address: completed analysis, zero claims, zero taint", async () => {
    vi.stubGlobal("fetch", mockExplorer({ [TARGET]: { asc: [], desc: [] } }));

    const result = await analyzeClusterTaint(TARGET as `0x${string}`);

    expect(result.analysisStatus).toBe("completed");
    expect(result.hasTaint).toBe(false);
    expect(result.isSweeperActive).toBe(false);
    expect(result.sweepVelocitySeconds).toBeNull();
    expect(result.seedFunder).toBe("None observed");
    expect(result.forensicTraceNotes.join(" ")).toContain("No inbound native funding");
  });

  it("marks itself unavailable instead of passing silently when the explorer is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection refused"); }));

    const result = await analyzeClusterTaint(TARGET as `0x${string}`);

    expect(result.analysisStatus).toBe("unavailable");
    expect(result.hasTaint).toBe(false);
    expect(result.isSweeperActive).toBe(false);
    expect(result.forensicTraceNotes[0]).toContain("unavailable");
  });

  it("counts zero-value ERC-20 transfer() calls as forwarding events", async () => {
    const token = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const history = [
      tx({ from: FUNDER, to: TARGET, value: ETH(0.0005), timeStamp: "100" }),
      tx({ from: "0x1111111111111111111111111111111111111111", to: TARGET, value: ETH(0.02), timeStamp: "200" }),
      tx({ from: TARGET, to: token, value: "0", methodId: "0xa9059cbb", functionName: "transfer(address to, uint256 value)", timeStamp: "208" }),
      tx({ from: "0x2222222222222222222222222222222222222222", to: TARGET, value: ETH(0.02), timeStamp: "300" }),
      tx({ from: TARGET, to: token, value: "0", methodId: "0xa9059cbb", functionName: "transfer(address to, uint256 value)", timeStamp: "308" }),
    ];
    const funderHistory = [
      tx({ from: FUNDER, to: TARGET, value: ETH(0.5), timeStamp: "100" }),
    ];

    vi.stubGlobal("fetch", mockExplorer({
      [TARGET]: { asc: history, desc: [...history].reverse() },
      [FUNDER]: { asc: funderHistory },
    }));

    const result = await analyzeClusterTaint(TARGET as `0x${string}`);

    // Deltas: 100->208 (108s), 200->208 (8s), 300->308 (8s) => median 8s: automated.
    // But no measured dispenser/aggregator link and value is retained => warning only.
    expect(result.isSweeperActive).toBe(true);
    expect(result.sweepVelocitySeconds).toBe(8);
    expect(result.taintSeverity).toBe("warning");
    expect(result.hasTaint).toBe(true);
  });
});
