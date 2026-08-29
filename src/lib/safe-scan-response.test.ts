import { describe, it, expect } from "vitest";

/**
 * Mirrors the safe parsing logic now used in src/app/page.tsx runScan.
 * The bug was: response.json() threw "Unexpected token 'A', "An error o..." is not valid JSON"
 * when Vercel returned a platform HTML/text error. We now read text first and try JSON.parse
 * inside a try/catch, surfacing the underlying failure without a SyntaxError.
 */
async function parseScanResponseSafely(response: Response): Promise<any> {
  let data: any = null;
  let rawText = "";
  try {
    rawText = await response.text();
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    const snippet = (rawText || "").slice(0, 500).trim();
    if (snippet) {
      throw new Error(
        snippet.toLowerCase().startsWith("an error")
          ? `Scan service returned a non-JSON error: ${snippet}`
          : snippet,
      );
    }
    throw new Error(`Scan service returned non-JSON response (HTTP ${response.status})`);
  }

  if (!response.ok) {
    throw new Error(data?.error || `The scan failed (HTTP ${response.status}).`);
  }

  return data;
}

describe("safe scan response handling (fix for non-JSON platform error)", () => {
  it("does not throw SyntaxError when API returns 'An error occurred...' text", async () => {
    const platformErrorText = "An error occurred with your deployment. Please try again.";
    const makeResponse = () =>
      new Response(platformErrorText, {
        status: 500,
        headers: { "content-type": "text/plain" },
      });

    await expect(parseScanResponseSafely(makeResponse())).rejects.toThrow(
      /Scan service returned a non-JSON error/,
    );

    // Ensure the error message does NOT contain the old JSON parse message
    try {
      await parseScanResponseSafely(makeResponse());
    } catch (e: any) {
      expect(e.message).not.toContain("Unexpected token");
      expect(e.message).toContain("An error occurred");
    }
  });

  it("handles valid JSON error responses normally", async () => {
    const mockResponse = new Response(JSON.stringify({ error: "Rate limit reached" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });

    await expect(parseScanResponseSafely(mockResponse)).rejects.toThrow("Rate limit reached");
  });

  it("parses successful JSON receipt", async () => {
    const fakeReceipt = { verdict: "LOW OBSERVED RISK", address: "0x123", firedRules: [{ id: "R1" }] };
    const mockResponse = new Response(JSON.stringify(fakeReceipt), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const data = await parseScanResponseSafely(mockResponse);
    expect(data.verdict).toBe("LOW OBSERVED RISK");
  });

  it("handles empty body as empty object and throws with status", async () => {
    const mockResponse = new Response("", {
      status: 502,
      headers: { "content-type": "text/plain" },
    });

    // Empty body is parsed as {} then treated as failed scan – must still be JSON-safe and not throw SyntaxError
    await expect(parseScanResponseSafely(mockResponse)).rejects.toThrow(/The scan failed/);
    try {
      await parseScanResponseSafely(new Response("", { status: 502 }));
    } catch (e: any) {
      expect(e.message).not.toContain("Unexpected token");
    }
  });

  it("preserves underlying failure text without inventing a verdict", async () => {
    // Simulate the exact bug text: "An error o..." is not valid JSON
    const raw = "An error occurred in the scan service";
    const mockResponse = new Response(raw, { status: 500 });

    try {
      await parseScanResponseSafely(mockResponse);
      throw new Error("should have thrown");
    } catch (e: any) {
      // Must NOT invent a verdict, must surface the underlying failure
      expect(e.message.toLowerCase()).toContain("an error");
      expect(e.message).not.toContain("LOW OBSERVED RISK");
      expect(e.message).not.toContain("HIGH OBSERVED RISK");
    }
  });
});
