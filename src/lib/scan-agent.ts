import { createHash } from "node:crypto";
import {
  getAddress,
  isAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";
import { baseClient } from "./base-client";
import { formatEth, storageValueToAddress } from "./format";
import { evaluateRisk, RISK_ENGINE_VERSION } from "./risk-engine";
import type { EvidenceItem, ScanReceipt, TargetType } from "./scan-types";

const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;

const inputSchema = z.object({
  address: z
    .string()
    .trim()
    .refine((value) => isAddress(value), "Enter a valid EVM address.")
    .transform((value) => getAddress(value))
    .refine((value) => value !== zeroAddress, "The zero address cannot be scanned."),
});

export class ScanInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanInputError";
  }
}

interface EvidenceContext {
  address: Address;
  blockNumber: bigint;
  observedAt: string;
}

function explorerUrl(address: Address): string {
  return `https://basescan.org/address/${address}`;
}

function evidence(
  context: EvidenceContext,
  item: Omit<EvidenceItem, "blockNumber" | "observedAt" | "explorerUrl">,
): EvidenceItem {
  return {
    ...item,
    blockNumber: context.blockNumber.toString(),
    observedAt: context.observedAt,
    explorerUrl: explorerUrl(context.address),
  };
}

function unavailableEvidence(
  context: EvidenceContext,
  id: string,
  label: string,
  claim: string,
  source: string,
  method: string,
  limitations: string[],
): EvidenceItem {
  return evidence(context, {
    id,
    label,
    status: "unavailable",
    claim,
    source,
    method,
    rawValue: null,
    limitations,
  });
}

function createReceiptId(payload: object): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  return `shield_${digest.slice(0, 20)}`;
}

export function parseScanInput(input: unknown): Address {
  const result = inputSchema.safeParse(input);
  if (!result.success) {
    throw new ScanInputError(result.error.issues[0]?.message || "Invalid scan input.");
  }
  return result.data.address;
}

export async function runShieldScan(address: Address): Promise<ScanReceipt> {
  const scannedAt = new Date().toISOString();

  const [chainId, blockNumber] = await Promise.all([
    baseClient.getChainId(),
    baseClient.getBlockNumber(),
  ]);

  if (chainId !== 8453) {
    throw new Error(`Connected RPC returned chain ID ${chainId}, not Base mainnet.`);
  }

  const [block, code] = await Promise.all([
    baseClient.getBlock({ blockNumber }),
    baseClient.getCode({ address, blockNumber }),
  ]);

  const normalizedCode = code || "0x";
  const isContract = normalizedCode !== "0x";
  const targetType: TargetType = isContract ? "contract" : "wallet";
  const blockTimestamp = new Date(Number(block.timestamp) * 1000).toISOString();
  const context: EvidenceContext = { address, blockNumber, observedAt: scannedAt };
  const items: EvidenceItem[] = [];

  items.push(
    evidence(context, {
      id: "EVIDENCE_CHAIN_STATE",
      label: "Base chain state captured",
      status: "pass",
      claim: `The scan used Base mainnet block ${blockNumber.toString()}.`,
      source: "base-rpc",
      method: "eth_chainId + eth_getBlockByNumber",
      rawValue: `chainId=${chainId}; block=${blockNumber.toString()}`,
      limitations: ["The latest block can be reorganized in rare circumstances."],
    }),
  );

  items.push(
    evidence(context, {
      id: "EVIDENCE_TARGET_TYPE",
      label: isContract ? "Smart contract detected" : "Wallet address detected",
      status: "pass",
      claim: isContract
        ? "Deployed bytecode existed at this address at the scanned block."
        : "No deployed bytecode existed at this address at the scanned block.",
      source: "base-rpc",
      method: "eth_getCode",
      rawValue: isContract
        ? `bytecodeBytes=${Math.max(0, (normalizedCode.length - 2) / 2)}`
        : "0x",
      limitations: isContract
        ? ["Bytecode presence proves contract deployment, not safety or source verification."]
        : [
            "No bytecode normally indicates an externally owned account, but it does not establish who controls it.",
          ],
    }),
  );

  const [balanceResult, nonceResult] = await Promise.allSettled([
    baseClient.getBalance({ address, blockNumber }),
    baseClient.getTransactionCount({ address, blockNumber }),
  ]);

  if (balanceResult.status === "fulfilled") {
    items.push(
      evidence(context, {
        id: "EVIDENCE_NATIVE_BALANCE",
        label: "Native balance read",
        status: "info",
        claim: `The address held ${formatEth(balanceResult.value)} at the scanned block.`,
        source: "base-rpc",
        method: "eth_getBalance",
        rawValue: balanceResult.value.toString(),
        limitations: ["Token balances are not included in this value."],
      }),
    );
  } else {
    items.push(
      unavailableEvidence(
        context,
        "EVIDENCE_NATIVE_BALANCE",
        "Native balance unavailable",
        "Shield could not retrieve the native ETH balance.",
        "base-rpc",
        "eth_getBalance",
        ["This failed check was not treated as a safe result."],
      ),
    );
  }

  if (nonceResult.status === "fulfilled") {
    items.push(
      evidence(context, {
        id: "EVIDENCE_TRANSACTION_COUNT",
        label: "Transaction count read",
        status: "info",
        claim: `The address had transaction count ${nonceResult.value} at the scanned block.`,
        source: "base-rpc",
        method: "eth_getTransactionCount",
        rawValue: nonceResult.value,
        limitations: [
          "For contracts, this value does not describe the contract's full interaction history.",
          "Transaction count alone cannot establish trust.",
        ],
      }),
    );
  } else {
    items.push(
      unavailableEvidence(
        context,
        "EVIDENCE_TRANSACTION_COUNT",
        "Transaction count unavailable",
        "Shield could not retrieve the address transaction count.",
        "base-rpc",
        "eth_getTransactionCount",
        ["This failed check was not treated as a safe result."],
      ),
    );
  }

  if (isContract) {
    let implementationAddress: string | null = null;
    try {
      const implementationValue = await baseClient.getStorageAt({
        address,
        slot: EIP1967_IMPLEMENTATION_SLOT,
        blockNumber,
      });
      implementationAddress = storageValueToAddress(implementationValue);

      items.push(
        evidence(context, {
          id: "EVIDENCE_PROXY_IMPLEMENTATION",
          label: implementationAddress
            ? "Upgradeable proxy indicator detected"
            : "No standard proxy implementation found",
          status: implementationAddress ? "warning" : "pass",
          claim: implementationAddress
            ? `The standard EIP-1967 implementation slot points to ${implementationAddress}.`
            : "The EIP-1967 implementation slot did not contain an implementation address.",
          source: "base-rpc",
          method: "eth_getStorageAt",
          rawValue: implementationAddress,
          limitations: [
            "A proxy is not automatically malicious.",
            "Non-standard proxy patterns may not use this storage slot.",
          ],
        }),
      );
    } catch {
      items.push(
        unavailableEvidence(
          context,
          "EVIDENCE_PROXY_IMPLEMENTATION",
          "Proxy indicator unavailable",
          "Shield could not inspect the EIP-1967 implementation slot.",
          "base-rpc",
          "eth_getStorageAt",
          ["Non-standard proxies require additional analysis."],
        ),
      );
    }

    items.push(
      unavailableEvidence(
        context,
        "EVIDENCE_CONTRACT_VERIFICATION",
        "Contract verification not checked",
        "Verified-source metadata is not available in the baseline RPC scan.",
        "etherscan-v2",
        "contract metadata",
        ["This check will require a server-side explorer API key."],
      ),
    );
  } else {
    items.push(
      unavailableEvidence(
        context,
        "EVIDENCE_ACTIVE_APPROVALS",
        "Active approvals not checked",
        "Approval exposure requires indexed event history and live allowance checks.",
        "indexed-events + base-rpc",
        "Approval events + eth_call",
        ["No conclusion about token approvals was made by this baseline scan."],
      ),
    );
  }

  items.push(
    unavailableEvidence(
      context,
      "EVIDENCE_RECENT_ACTIVITY",
      "Recent indexed activity not checked",
      "The baseline RPC scan does not reconstruct historical transfers.",
      "indexed-data-provider",
      "address history",
      ["Balance and nonce are not substitutes for transaction-history analysis."],
    ),
  );

  const risk = evaluateRisk(targetType, items);
  const completed = items.filter((item) => item.status !== "unavailable").length;
  const unavailable = items.length - completed;

  const receiptWithoutId = {
    receiptVersion: "0.1" as const,
    riskEngineVersion: RISK_ENGINE_VERSION,
    network: "Base Mainnet" as const,
    chainId: 8453 as const,
    address,
    targetType,
    blockNumber: blockNumber.toString(),
    blockTimestamp,
    scannedAt,
    verdict: risk.verdict,
    summary: risk.summary,
    coverage: { completed, unavailable, total: items.length },
    evidence: items,
    firedRules: risk.rules,
    limitations: [
      "Shield is a decision-support tool, not a guarantee of safety.",
      "This baseline version does not simulate transactions or inspect every historical event.",
      "Never share a private key or wallet recovery phrase with Shield.",
    ],
  };

  return {
    receiptId: createReceiptId(receiptWithoutId),
    ...receiptWithoutId,
  };
}
