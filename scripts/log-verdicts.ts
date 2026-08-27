import fs from "node:fs";
import path from "node:path";
import { runShieldScan } from "../src/lib/scan-agent";
import type { Address } from "viem";

const WATCHLIST: Array<{ label: string; address: Address }> = [
  { label: "Base WETH9 Predeploy", address: "0x4200000000000000000000000000000000000006" as Address },
  { label: "Circle USDC Proxy", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address },
  { label: "vitalik.eth (EIP-7702)", address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as Address },
];

interface LogEntry {
  scannedAt: string;
  address: string;
  label: string;
  targetType: string;
  verdict: string;
  receiptId: string;
  receiptHash: string;
  blockNumber: string;
}

async function main() {
  const now = new Date();
  const dateSlug = now.toISOString().split("T")[0]; // YYYY-MM-DD
  const verdictsDir = path.resolve(process.cwd(), "verdicts");

  if (!fs.existsSync(verdictsDir)) {
    fs.mkdirSync(verdictsDir, { recursive: true });
  }

  const logFilePath = path.join(verdictsDir, `${dateSlug}.json`);
  let dailyLogs: LogEntry[] = [];

  if (fs.existsSync(logFilePath)) {
    try {
      dailyLogs = JSON.parse(fs.readFileSync(logFilePath, "utf8"));
    } catch {
      dailyLogs = [];
    }
  }

  console.log(`🛡️ Shield Public Verdicts Logger [${now.toISOString()}]`);
  console.log(`Scanning ${WATCHLIST.length} watchlist addresses on Base Mainnet...\n`);

  for (const item of WATCHLIST) {
    try {
      const receipt = await runShieldScan(item.address);
      const entry: LogEntry = {
        scannedAt: receipt.scannedAt,
        address: receipt.address,
        label: item.label,
        targetType: receipt.targetType,
        verdict: receipt.verdict,
        receiptId: receipt.receiptId,
        receiptHash: receipt.receiptHash || "n/a",
        blockNumber: receipt.blockNumber,
      };

      dailyLogs.unshift(entry);
      console.log(`[PASS] ${item.label} (${item.address}) -> Verdict: ${receipt.verdict} (Block #${receipt.blockNumber}, Hash: ${entry.receiptHash.slice(0, 14)}...)`);
    } catch (err: any) {
      console.error(`[FAIL] ${item.label} (${item.address}):`, err?.message || err);
    }
  }

  fs.writeFileSync(logFilePath, JSON.stringify(dailyLogs, null, 2), "utf8");
  console.log(`\n✓ Verdicts written to ${logFilePath} (Total entries today: ${dailyLogs.length})`);
}

main().catch((err) => {
  console.error("Fatal logger error:", err);
  process.exit(1);
});
