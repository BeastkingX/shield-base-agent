import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token") || "ETH";
  const address = searchParams.get("address") || "";

  let llamaKey = "coingecko:ethereum";

  if (token === "USDC" || address.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913") {
    llamaKey = "base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  } else if (token === "WETH" || address.toLowerCase() === "0x4200000000000000000000000000000000000006") {
    llamaKey = "coingecko:ethereum";
  } else if (token === "DEGEN" || address.toLowerCase() === "0x4ed4e862860bed51a9570b96d89af5e1b0efefed") {
    llamaKey = "base:0x4ed4e862860bed51a9570b96d89af5e1b0efefed";
  } else if (address && address.startsWith("0x")) {
    llamaKey = `base:${address}`;
  }

  try {
    const res = await fetch(`https://coins.llama.fi/prices/current/${llamaKey}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
    });

    if (res.ok) {
      const data = await res.json();
      const coinData = data.coins?.[llamaKey];
      if (coinData && typeof coinData.price === "number") {
        return NextResponse.json({
          price: coinData.price,
          symbol: coinData.symbol || token,
        });
      }
    }
  } catch (err) {}

  // Fallbacks
  const fallbackPrices: Record<string, number> = {
    ETH: 2500,
    WETH: 2500,
    USDC: 1.0,
    DAI: 1.0,
    cbETH: 2800,
    DEGEN: 0.0011,
  };

  return NextResponse.json({
    price: fallbackPrices[token] || 1.0,
    symbol: token,
  });
}
