import { NextRequest, NextResponse } from "next/server";
import { isAddress, getAddress, type Address, type Hex } from "viem";
import { baseClient } from "@/lib/base-client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const addressParam = searchParams.get("address")?.trim();

  if (!addressParam || !isAddress(addressParam)) {
    return NextResponse.json(
      { error: "Invalid token address." },
      { status: 400 },
    );
  }

  const tokenAddress = getAddress(addressParam);

  try {
    const [decimalsHex, symbolHex, nameHex, bytecode] = await Promise.all([
      baseClient.call({
        to: tokenAddress,
        data: "0x313ce567" as Hex, // decimals()
      }),
      baseClient.call({
        to: tokenAddress,
        data: "0x95d89b41" as Hex, // symbol()
      }),
      baseClient.call({
        to: tokenAddress,
        data: "0x06fdde03" as Hex, // name()
      }),
      baseClient.getCode({ address: tokenAddress }),
    ]);

    if (!bytecode || bytecode === "0x") {
      return NextResponse.json(
        { error: "No contract deployed at this address." },
        { status: 404 },
      );
    }

    // Parse decimals
    let decimals = 18;
    if (decimalsHex.data) {
      try {
        decimals = Number(BigInt(decimalsHex.data));
      } catch {
        decimals = 18;
      }
    }

    return NextResponse.json({
      address: tokenAddress,
      decimals,
      symbol: "ERC-20",
      name: `Token (${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)})`,
    });
  } catch (error) {
    return NextResponse.json({
      address: tokenAddress,
      decimals: 18,
      symbol: "CUSTOM",
      name: "Custom ERC-20",
    });
  }
}
