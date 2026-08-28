import { afterEach, describe, expect, it, vi } from "vitest";
import { getThreatReport, resetScamSnifferCacheForTesting } from "./threat-intel";
import type { Address } from "viem";

const CLEAN_ADDRESS = "0x1111111111111111111111111111111111111111" as Address;
const SCAM_ADDRESS = "0x2222222222222222222222222222222222222222" as Address;

afterEach(() => {
  vi.restoreAllMocks();
  resetScamSnifferCacheForTesting();
});

describe("unified threat intelligence (GoPlus Base + Eth + ScamSniffer)", () => {
  it("flags danger when address is listed only in ScamSniffer DB", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("raw.githubusercontent.com")) {
        return new Response(JSON.stringify([SCAM_ADDRESS.toLowerCase()]), { status: 200 });
      }
      // GoPlus returns clean
      return new Response(JSON.stringify({ code: 1, result: {} }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const report = await getThreatReport(SCAM_ADDRESS);
    expect(report.overallStatus).toBe("danger");
    expect(report.scamsniffer).toBe("listed");
    expect(report.dangerFlags.join(" ")).toContain("ScamSniffer");
  });

  it("flags danger when threat is detected on GoPlus Ethereum even if clean on Base", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("chain_id=1")) {
        return new Response(
          JSON.stringify({
            code: 1,
            result: { stealing_attack: "1", data_source: "GoPlus Eth" },
          }),
          { status: 200 },
        );
      }
      if (url.includes("chain_id=8453")) {
        return new Response(JSON.stringify({ code: 1, result: {} }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const report = await getThreatReport(CLEAN_ADDRESS);
    expect(report.overallStatus).toBe("danger");
    expect(report.dangerFlags.join(" ")).toContain("Ethereum: stealing_attack");
  });

  it("returns unavailable when all three threat intelligence sources fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network timeout"); }));

    const report = await getThreatReport(CLEAN_ADDRESS);
    expect(report.overallStatus).toBe("unavailable");
    expect(report.sourcesChecked).toBe(0);
  });
});
