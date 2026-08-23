import { NextResponse } from "next/server";
import { baseClient } from "@/lib/base-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();

  try {
    const [chainId, blockNumber] = await Promise.all([
      baseClient.getChainId(),
      baseClient.getBlockNumber(),
    ]);

    return NextResponse.json({
      ok: chainId === 8453,
      network: "Base Mainnet",
      chainId,
      blockNumber: blockNumber.toString(),
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        network: "Base Mainnet",
        error: "Base RPC was unavailable. No safety conclusion was produced.",
        checkedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
