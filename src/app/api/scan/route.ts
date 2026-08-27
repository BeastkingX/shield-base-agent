import { NextRequest, NextResponse } from "next/server";
import {
  parseScanInput,
  runShieldScan,
  ScanInputError,
} from "@/lib/scan-agent";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

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
    const receipt = await runShieldScan(address);

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

    console.error("Shield scan failed", error);
    return NextResponse.json(
      {
        error:
          "Shield could not complete the Base scan. No safety conclusion was produced; please try again.",
      },
      { status: 502 },
    );
  }
}
