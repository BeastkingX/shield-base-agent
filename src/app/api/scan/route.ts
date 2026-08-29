import { NextRequest, NextResponse } from "next/server";
import {
  parseScanInput,
  runShieldScan,
  ScanInputError,
} from "@/lib/scan-agent";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * A full Shield scan reads Base RPC, indexed history, approvals and threat
 * intel, and every provider call now carries a bounded retry policy. 30s keeps
 * the retries inside the platform limit instead of being killed mid-flight.
 * We also race the scan against a hard budget so that even if a provider
 * stalls, we return JSON (never a platform HTML page).
 */
export const maxDuration = 30;
const SCAN_HARD_BUDGET_MS = 26_000;

function timeoutError(): Error {
  const err = new Error(
    "Scan timed out while collecting on-chain evidence. No safety conclusion was produced; please try again.",
  );
  err.name = "ScanTimeoutError";
  return err;
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  if (!rateLimit(`scan:${ip}`, 10, 60_000)) {
    return NextResponse.json(
      { error: "Rate limit reached. Please wait a minute and try again." },
      { status: 429 },
    );
  }

  try {
    const body = await request.json();
    const address = parseScanInput(body);

    // Race the scan against a hard budget so Vercel never returns a non-JSON
    // platform error page. The timeout is caught below and turned into a
    // 504 JSON error with a truthful message (no invented verdict).
    const receipt = await Promise.race([
      runShieldScan(address),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(timeoutError()), SCAN_HARD_BUDGET_MS),
      ),
    ]);

    return NextResponse.json(receipt, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof ScanInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "The request body must be valid JSON." },
        { status: 400 },
      );
    }

    if (error instanceof Error && error.name === "ScanTimeoutError") {
      console.error("Shield scan timed out", error);
      return NextResponse.json(
        { error: error.message },
        { status: 504, headers: { "Cache-Control": "no-store" } },
      );
    }

    console.error("Shield scan failed", error);
    return NextResponse.json(
      {
        error:
          "Shield could not complete the Base scan. No safety conclusion was produced; please try again.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
