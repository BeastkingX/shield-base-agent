import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock scan-agent
vi.mock("@/lib/scan-agent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/scan-agent")>("@/lib/scan-agent");
  return {
    ...actual,
    runShieldScan: vi.fn(),
    parseScanInput: actual.parseScanInput,
  };
});

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => true,
  clientIp: () => "127.0.0.1",
}));

import { POST } from "./route";
import { runShieldScan } from "@/lib/scan-agent";

describe("POST /api/scan – JSON safety (fix for Preview platform error)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns JSON 400 for invalid address, not HTML", async () => {
    const req = new NextRequest("http://localhost/api/scan", {
      method: "POST",
      body: JSON.stringify({ address: "not-an-address" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("returns JSON 502 when scan throws, never HTML", async () => {
    vi.mocked(runShieldScan).mockRejectedValue(new Error("RPC down"));

    const req = new NextRequest("http://localhost/api/scan", {
      method: "POST",
      body: JSON.stringify({ address: "0x00000c07575bb4e64457687a0382b4d3ea470000" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect([502, 504]).toContain(res.status);
    expect(body.error).toContain("could not complete");
    // Must NOT invent a verdict
    expect(body.verdict).toBeUndefined();
  });

  it("returns JSON 504 on timeout, not platform HTML 'An error occurred...'", async () => {
    // Use fake timers so we don't actually wait 26s. The route races runShieldScan
    // against a 26s timeout; we fast-forward timers to trigger the timeout path.
    vi.useFakeTimers();
    vi.mocked(runShieldScan).mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    const req = new NextRequest("http://localhost/api/scan", {
      method: "POST",
      body: JSON.stringify({ address: "0x00000c07575bb4e64457687a0382b4d3ea470000" }),
      headers: { "Content-Type": "application/json" },
    });

    const postPromise = POST(req);

    // Fast-forward past SCAN_HARD_BUDGET_MS (26s)
    await vi.advanceTimersByTimeAsync(27_000);

    const res = await postPromise;
    vi.useRealTimers();

    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(res.status).toBe(504);
    expect(body.error.toLowerCase()).toContain("timed out");
    expect(body.verdict).toBeUndefined();
  }, 10_000);

  it("returns JSON receipt for successful scan", async () => {
    const fakeReceipt = {
      address: "0x00000c07575bb4e64457687a0382b4d3ea470000",
      verdict: "HIGH OBSERVED RISK",
      firedRules: [{ id: "RULE_THREAT_INTEL" }],
      evidence: [],
      coverage: { completed: 5, unavailable: 0, total: 5 },
    };
    vi.mocked(runShieldScan).mockResolvedValue(fakeReceipt as any);

    const req = new NextRequest("http://localhost/api/scan", {
      method: "POST",
      body: JSON.stringify({ address: "0x00000c07575bb4e64457687a0382b4d3ea470000" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.verdict).toBe("HIGH OBSERVED RISK");
  });

  it("never produces fake clean result when data unavailable", async () => {
    // When threat intel unavailable, receipt should be INSUFFICIENT DATA, not LOW
    const receiptWithGaps = {
      address: "0x00000c07575bb4e64457687a0382b4d3ea470000",
      verdict: "INSUFFICIENT DATA",
      firedRules: [],
      evidence: [
        { id: "EVIDENCE_THREAT_INTEL", status: "unavailable" },
        { id: "EVIDENCE_MONEY_TRAIL", status: "unavailable" },
      ],
      coverage: { completed: 0, unavailable: 2, total: 2 },
    };
    vi.mocked(runShieldScan).mockResolvedValue(receiptWithGaps as any);

    const req = new NextRequest("http://localhost/api/scan", {
      method: "POST",
      body: JSON.stringify({ address: "0x00000c07575bb4e64457687a0382b4d3ea470000" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    const body = await res.json();
    expect(body.verdict).toBe("INSUFFICIENT DATA");
    expect(body.verdict).not.toBe("LOW OBSERVED RISK");
  });
});
