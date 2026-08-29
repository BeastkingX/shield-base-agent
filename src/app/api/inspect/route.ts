import { NextRequest, NextResponse } from "next/server";
import { inspectSignaturePayload } from "@/lib/popup-inspector";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Signature inspection resolves spender contracts and approval exposure through
 * providers that now retry on transient failures; 30s keeps that inside the
 * platform limit.
 */
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  if (!rateLimit(`inspect:${ip}`, 10, 60_000)) {
    return NextResponse.json(
      { error: "Rate limit reached. Please wait a minute and try again." },
      { status: 429 },
    );
  }

  try {
    const body = await request.json();
    const payload = body?.payload;

    if (!payload || typeof payload !== "string" || !payload.trim()) {
      return NextResponse.json(
        { error: "A signature payload or JSON text is required." },
        { status: 400 },
      );
    }

    if (payload.length > 20_000) {
      return NextResponse.json(
        { error: "Payload exceeds maximum allowed size of 20 KB." },
        { status: 400 },
      );
    }

    const receipt = await inspectSignaturePayload(payload);
    return NextResponse.json(receipt);
  } catch (err: any) {
    console.error("Popup inspection error:", err);
    return NextResponse.json(
      { error: "Failed to inspect signature payload: " + (err?.message || "Internal error") },
      { status: 500 },
    );
  }
}
