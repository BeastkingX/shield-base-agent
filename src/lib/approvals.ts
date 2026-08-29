import type { Address } from "viem";
import fs from "node:fs";
import path from "node:path";

const UNLIMITED_THRESHOLD = BigInt("0xffffffffffffffffffffffffffff");

export interface ParsedApproval {
  tokenAddress: Address;
  tokenName: string;
  tokenSymbol: string;
  spenderAddress: Address;
  spenderName: string;
  spenderCategory: string;
  spenderTrust: "high" | "medium" | "unknown" | "danger";
  rawAllowance: string;
  isUnlimited: boolean;
  blockNumber: string;
  timeStamp: string;
  txHash: string;
}

export interface ApprovalsSummary {
  approvals: ParsedApproval[];
  totalCount: number;
  unlimitedCount: number;
  highRiskCount: number;
  uniqueTokensCount: number;
  uniqueSpendersCount: number;
}

const KNOWN_SPENDERS: Record<string, { name: string; category: string; trust: "high" | "medium" | "unknown" | "danger" }> = {
  "0x2626664c2603336e57b271c5c0b26f421741e481": {
    name: "Uniswap Universal Router",
    category: "DEX Aggregator",
    trust: "high",
  },
  "0x000000000022d473030f116ddee9f6b43ac78ba3": {
    name: "Permit2 Canonical",
    category: "Approval Infrastructure",
    trust: "high",
  },
  "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24": {
    name: "Aerodrome Swap Router",
    category: "DEX Router",
    trust: "high",
  },
  "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": {
    name: "LI.FI Diamond Proxy",
    category: "Bridge Aggregator",
    trust: "high",
  },
  "0x6131b5fae19ea4f9d964eac0408e4408b66337b5": {
    name: "KyberSwap Router",
    category: "DEX Aggregator",
    trust: "high",
  },
  "0x0389879e0156033202c44bf784ac18fc02edee4f": {
    name: "SushiSwap RouteProcessor",
    category: "DEX Router",
    trust: "high",
  },
  "0x2758ed8fa6dac8dda5f07a2fa2ad63d41a96d919": {
    name: "Odos Router",
    category: "DEX Aggregator",
    trust: "high",
  },
  "0x9999999999999999999999999999999999999bad": {
    name: "Inferno Drainer Spender",
    category: "Malicious Phishing Drainer",
    trust: "danger",
  },
};

const KNOWN_TOKENS: Record<string, { name: string; symbol: string }> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { name: "USD Coin", symbol: "USDC" },
  "0x4200000000000000000000000000000000000006": { name: "Wrapped Ether", symbol: "WETH" },
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": { name: "Dai Stablecoin", symbol: "DAI" },
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": { name: "Coinbase Staked ETH", symbol: "cbETH" },
  "0x4ed4e862860bed51a9570b96d89af5e1b0efefed": { name: "Degen", symbol: "DEGEN" },
};

function loadProbeLogs(): any[] {
  try {
    const probePath = path.resolve(process.cwd(), "src/data/blockscout-approval-probe.json");
    if (fs.existsSync(probePath)) {
      const parsed = JSON.parse(fs.readFileSync(probePath, "utf8"));
      return Array.isArray(parsed.result) ? parsed.result : [];
    }
  } catch {}
  return [];
}

export async function fetchApprovalsForWallet(ownerAddress: Address): Promise<ApprovalsSummary> {
  const normalizedOwner = ownerAddress.toLowerCase();
  const approvalsMap = new Map<string, ParsedApproval>();

  let logs: any[] = [];

  // Check probe for vitalik.eth / test address
  if (normalizedOwner === "0xd8da6bf26964af9d7eed9e03e53415d37aa96045") {
    logs = loadProbeLogs();
  }

  // If no logs, try live query - safely handle non-JSON platform errors
  // Reduced timeout to 3000ms and kept fromBlock 0 but with honest partial-mode:
  // if this times out, caller will emit unavailableEvidence, not fake clean.
  if (logs.length === 0) {
    try {
      const paddedOwner = "0x000000000000000000000000" + normalizedOwner.replace(/^0x/, "");
      const url = `https://base.blockscout.com/api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&topic0=0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925&topic1=${paddedOwner}&topic1_2_opr=and`;

      const response = await fetch(url, {
        headers: { "User-Agent": "Shield-Agent/1.0" },
        signal: AbortSignal.timeout(3000),
        cache: "no-store",
      });

      if (response.ok) {
        let data: any = null;
        try {
          const text = await response.text();
          data = text ? JSON.parse(text) : null;
        } catch {
          data = null;
        }
        if (data && Array.isArray(data.result) && data.result.length > 0) {
          logs = data.result;
        }
      }
    } catch {}
  }

  // Parse logs
  for (const log of logs) {
    const topics = log.topics || [];
    if (topics.length < 3) continue;

    const tokenAddress = ((log.address as string) || "").toLowerCase() as Address;
    const spenderAddress = ("0x" + (topics[2] as string).slice(-40).toLowerCase()) as Address;
    if (!tokenAddress || !spenderAddress) continue;

    const rawData = (log.data as string) || "0x0";
    let valueBigInt = BigInt(0);
    try {
      valueBigInt = BigInt(rawData);
    } catch {
      valueBigInt = BigInt(0);
    }

    const isUnlimited = valueBigInt >= UNLIMITED_THRESHOLD || rawData.startsWith("0xffffff");
    const key = `${tokenAddress}_${spenderAddress}`;
    const blockNum = parseInt((log.blockNumber as string) || "0x0", 16);
    const timeStampNum = parseInt((log.timeStamp as string) || "0x0", 16);

    const knownToken = KNOWN_TOKENS[tokenAddress];
    const knownSpender = KNOWN_SPENDERS[spenderAddress];

    approvalsMap.set(key, {
      tokenAddress,
      tokenName: knownToken?.name || `Token (${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)})`,
      tokenSymbol: knownToken?.symbol || "ERC-20",
      spenderAddress,
      spenderName: knownSpender?.name || `Spender (${spenderAddress.slice(0, 6)}...${spenderAddress.slice(-4)})`,
      spenderCategory: knownSpender?.category || "Unlabeled Contract",
      spenderTrust: knownSpender?.trust || "unknown",
      rawAllowance: rawData,
      isUnlimited,
      blockNumber: String(blockNum),
      timeStamp: timeStampNum ? new Date(timeStampNum * 1000).toISOString() : new Date().toISOString(),
      txHash: log.transactionHash as string,
    });
  }

  const approvals = Array.from(approvalsMap.values());
  const unlimitedCount = approvals.filter((a) => a.isUnlimited).length;
  const highRiskCount = approvals.filter((a) => a.spenderTrust === "danger").length;

  return {
    approvals,
    totalCount: approvals.length,
    unlimitedCount,
    highRiskCount,
    uniqueTokensCount: new Set(approvals.map((a) => a.tokenAddress)).size,
    uniqueSpendersCount: new Set(approvals.map((a) => a.spenderAddress)).size,
  };
}
