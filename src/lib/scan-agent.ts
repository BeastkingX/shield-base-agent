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
import { getBaseProtocolContract } from "./base-protocol-contracts";
import {
  ExplorerUnavailableError,
  getContractSourceMetadata,
  type IndexedTransaction,
} from "./etherscan-client";
import { formatEth, storageValueToAddress } from "./format";
import {
  getIndexedContractCreation,
  getIndexedRecentTransactions,
} from "./indexed-data";
import { evaluateRisk, RISK_ENGINE_VERSION } from "./risk-engine";
import type {
  EvidenceCategory,
  EvidenceItem,
  ScanReceipt,
  TargetType,
} from "./scan-types";

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

function addressExplorerUrl(address: Address): string {
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
    explorerUrl: addressExplorerUrl(context.address),
  };
}

function unavailableEvidence(
  context: EvidenceContext,
  category: EvidenceCategory,
  id: string,
  label: string,
  claim: string,
  source: string,
  method: string,
  limitations: string[],
): EvidenceItem {
  return evidence(context, {
    id,
    category,
    label,
    status: "unavailable",
    claim,
    source,
    method,
    rawValue: null,
    limitations,
  });
}

function explorerFailureLimitations(error: unknown): string[] {
  if (error instanceof ExplorerUnavailableError && error.code === "missing-key") {
    return [
      "A server-side Blockscout API key is recommended for free Base indexed-history checks.",
      "An Etherscan key can supply this evidence only when its plan includes Base API access.",
      "The missing check was not treated as a safe result.",
    ];
  }

  const providerDetail =
    error instanceof Error
      ? error.message.replace(/(?:proapi_|[A-Z0-9]{24,})[A-Za-z0-9_-]*/g, "[redacted]")
      : null;
  return [
    "Every configured indexed-data provider failed this check.",
    ...(providerDetail ? [`Provider response: ${providerDetail}`] : []),
    "The failed check was not treated as a safe result.",
  ];
}

function sourceMetadataFailureLimitations(error: unknown): string[] {
  if (error instanceof ExplorerUnavailableError && error.code === "missing-key") {
    return [
      "A server-side Etherscan API key is required for verified-source metadata.",
      "The missing check was not treated as a safe result.",
    ];
  }
  return [
    "Etherscan did not complete the verified-source metadata check.",
    "The failed check was not treated as a safe result.",
  ];
}

function createReceiptId(payload: object): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  return `shield_${digest.slice(0, 20)}`;
}

function unixTimestamp(value: string): string | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function ageInDays(timestamp: string, now: string): number | null {
  const created = Date.parse(timestamp);
  const observed = Date.parse(now);
  if (!Number.isFinite(created) || !Number.isFinite(observed)) return null;
  return Math.max(0, Math.floor((observed - created) / 86_400_000));
}

function summarizeTransactions(
  transactions: IndexedTransaction[],
  address: Address,
) {
  const normalizedAddress = address.toLowerCase();
  const failed = transactions.filter(
    (transaction) =>
      transaction.isError === "1" || transaction.txreceipt_status === "0",
  ).length;
  const incoming = transactions.filter(
    (transaction) => transaction.to.toLowerCase() === normalizedAddress,
  ).length;
  const outgoing = transactions.filter(
    (transaction) => transaction.from.toLowerCase() === normalizedAddress,
  ).length;
  const latest = transactions[0];
  const latestAt = latest ? unixTimestamp(latest.timeStamp) : null;

  return { failed, incoming, outgoing, latest, latestAt };
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
      category: "chain",
      label: "Base chain state captured",
      status: "pass",
      claim: `The scan used Base mainnet block ${blockNumber.toString()}.`,
      source: "base-rpc",
      method: "eth_chainId + eth_getBlockByNumber",
      rawValue: `chainId=${chainId}; block=${blockNumber.toString()}`,
      facts: {
        Network: "Base Mainnet",
        "Chain ID": chainId,
        Block: blockNumber.toString(),
        "Block time": blockTimestamp,
      },
      limitations: ["The latest block can be reorganized in rare circumstances."],
    }),
  );

  items.push(
    evidence(context, {
      id: "EVIDENCE_TARGET_TYPE",
      category: "identity",
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
      facts: {
        Classification: isContract ? "Smart contract" : "Wallet",
        "Bytecode bytes": isContract
          ? Math.max(0, (normalizedCode.length - 2) / 2)
          : 0,
      },
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
        category: "chain",
        label: "Native balance read",
        status: "info",
        claim: `The address held ${formatEth(balanceResult.value)} at the scanned block.`,
        source: "base-rpc",
        method: "eth_getBalance",
        rawValue: balanceResult.value.toString(),
        facts: { "Native balance": formatEth(balanceResult.value) },
        limitations: ["Token balances are not included in this value."],
      }),
    );
  } else {
    items.push(
      unavailableEvidence(
        context,
        "chain",
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
        category: "history",
        label: "Transaction count read",
        status: "info",
        claim: `The address had transaction count ${nonceResult.value} at the scanned block.`,
        source: "base-rpc",
        method: "eth_getTransactionCount",
        rawValue: nonceResult.value,
        facts: { "Transaction count": nonceResult.value },
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
        "history",
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
    try {
      const implementationValue = await baseClient.getStorageAt({
        address,
        slot: EIP1967_IMPLEMENTATION_SLOT,
        blockNumber,
      });
      const implementationAddress = storageValueToAddress(implementationValue);

      items.push(
        evidence(context, {
          id: "EVIDENCE_PROXY_IMPLEMENTATION",
          category: "identity",
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
          facts: {
            "EIP-1967 proxy": Boolean(implementationAddress),
            Implementation: implementationAddress,
          },
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
          "identity",
          "EVIDENCE_PROXY_IMPLEMENTATION",
          "Proxy indicator unavailable",
          "Shield could not inspect the EIP-1967 implementation slot.",
          "base-rpc",
          "eth_getStorageAt",
          ["Non-standard proxies require additional analysis."],
        ),
      );
    }

    const protocolContract = getBaseProtocolContract(address);
    const [sourceResult, creationResult, historyResult] = await Promise.allSettled([
      getContractSourceMetadata(address),
      protocolContract
        ? Promise.resolve(null)
        : getIndexedContractCreation(address),
      getIndexedRecentTransactions(address),
    ]);

    if (sourceResult.status === "fulfilled") {
      const metadata = sourceResult.value;
      items.push(
        evidence(context, {
          id: "EVIDENCE_CONTRACT_VERIFICATION",
          category: "identity",
          label: metadata.verified
            ? "Published source code verified"
            : "Source code is not verified",
          status: metadata.verified ? "pass" : "warning",
          claim: metadata.verified
            ? `${metadata.ContractName || "The contract"} has published source metadata indexed by BaseScan.`
            : "BaseScan did not return published, verified source code for this contract.",
          source: "etherscan-v2",
          method: "contract.getsourcecode",
          rawValue: metadata.verified,
          facts: {
            Verified: metadata.verified,
            "Contract name": metadata.ContractName || "Not published",
            Compiler: metadata.CompilerVersion || "Not published",
            License: metadata.LicenseType || "Not published",
            "Explorer proxy flag": metadata.Proxy === "1",
            Implementation: metadata.Implementation || null,
          },
          referenceUrl: `${addressExplorerUrl(address)}#code`,
          limitations: [
            "Published source improves transparency but is not a security audit.",
            "Verified code can still contain vulnerabilities or harmful behavior.",
          ],
        }),
      );
    } else {
      items.push(
        unavailableEvidence(
          context,
          "identity",
          "EVIDENCE_CONTRACT_VERIFICATION",
          "Contract verification unavailable",
          "Shield could not retrieve verified-source metadata.",
          "etherscan-v2",
          "contract.getsourcecode",
          sourceMetadataFailureLimitations(sourceResult.reason),
        ),
      );
    }

    if (protocolContract) {
      items.push(
        evidence(context, {
          id: "EVIDENCE_CONTRACT_CREATION",
          category: "history",
          label: "Official protocol predeploy identified",
          status: "pass",
          claim: `${protocolContract.name} matches the exact Base registry address and is specified as an OP Stack protocol predeploy.`,
          source: "base-official-registry",
          method: "exact address match + OP Stack predeploy specification",
          rawValue: `${protocolContract.deploymentMechanism}:${protocolContract.name}`,
          facts: {
            Contract: protocolContract.name,
            "Deployment mechanism": "Protocol predeploy",
            "Ordinary creation transaction": "Not applicable",
            "Official address match": true,
            Introduced: protocolContract.introduced,
            "Proxied by specification": protocolContract.proxied,
            "Protocol specification": protocolContract.protocolSpecificationUrl,
          },
          referenceUrl: protocolContract.baseRegistryUrl,
          limitations: [
            "Protocol predeploys are initialized in network state rather than through an ordinary user-submitted contract-creation transaction.",
            "An official address match establishes deployment provenance, not a guarantee that every interaction is safe.",
          ],
        }),
      );
    } else if (
      creationResult.status === "fulfilled" &&
      creationResult.value
    ) {
      const { data: creation, provider } = creationResult.value;
      const createdAt = unixTimestamp(creation.timestamp);
      const ageDays = createdAt ? ageInDays(createdAt, scannedAt) : null;
      items.push(
        evidence(context, {
          id: "EVIDENCE_CONTRACT_CREATION",
          category: "history",
          label: "Contract creation traced",
          status: "info",
          claim: createdAt
            ? `The contract was created ${ageDays?.toLocaleString() ?? "an unknown number of"} days ago by ${creation.contractCreator}.`
            : `The creation transaction points to deployer ${creation.contractCreator}.`,
          source: provider,
          method: "contract.getcontractcreation",
          rawValue: creation.txHash,
          facts: {
            Creator: creation.contractCreator,
            "Creation transaction": creation.txHash,
            "Creation block": creation.blockNumber,
            "Created at": createdAt,
            "Age in days": ageDays,
            Factory: creation.contractFactory || null,
          },
          referenceUrl: `https://basescan.org/tx/${creation.txHash}`,
          limitations: [
            "The deployer address may itself be a factory or contract.",
            "Contract age alone does not establish safety.",
          ],
        }),
      );
    } else {
      items.push(
        unavailableEvidence(
          context,
          "history",
          "EVIDENCE_CONTRACT_CREATION",
          "Contract creation unavailable",
          "Shield could not retrieve the indexed creation record.",
          "indexed-provider-fallback",
          "contract.getcontractcreation",
          creationResult.status === "rejected"
            ? explorerFailureLimitations(creationResult.reason)
            : [
                "No indexed creation record or official protocol provenance was available.",
                "The missing check was not treated as a safe result.",
              ],
        ),
      );
    }

    if (historyResult.status === "fulfilled") {
      const { data: transactions, provider, method } = historyResult.value;
      const summary = summarizeTransactions(transactions, address);
      items.push(
        evidence(context, {
          id: "EVIDENCE_RECENT_ACTIVITY",
          category: "history",
          label: transactions.length
            ? "Recent normal transactions inspected"
            : "No normal transactions returned",
          status: "info",
          claim: transactions.length
            ? `Shield inspected the ${transactions.length} most recent indexed normal transactions; ${summary.failed} were marked failed.`
            : "The explorer returned no normal transactions for this address.",
          source: provider,
          method,
          rawValue: transactions.length,
          facts: {
            "Transactions inspected": transactions.length,
            Failed: summary.failed,
            Incoming: summary.incoming,
            Outgoing: summary.outgoing,
            "Latest activity": summary.latestAt,
            "Latest method":
              summary.latest?.functionName || summary.latest?.methodId || null,
          },
          referenceUrl: summary.latest
            ? `https://basescan.org/tx/${summary.latest.hash}`
            : addressExplorerUrl(address),
          limitations: [
            "Only the latest ten normal transactions were inspected.",
            "Internal calls and token-transfer events require separate checks.",
          ],
        }),
      );
    } else {
      items.push(
        unavailableEvidence(
          context,
          "history",
          "EVIDENCE_RECENT_ACTIVITY",
          "Recent indexed activity unavailable",
          "Shield could not retrieve recent normal transactions.",
          "indexed-provider-fallback",
          "account.txlist + Blockscout REST address-transactions fallback",
          explorerFailureLimitations(historyResult.reason),
        ),
      );
    }
  } else {
    const historyResult = await Promise.allSettled([
      getIndexedRecentTransactions(address),
    ]);
    const result = historyResult[0];

    if (result.status === "fulfilled") {
      const { data: transactions, provider, method } = result.value;
      const summary = summarizeTransactions(transactions, address);
      items.push(
        evidence(context, {
          id: "EVIDENCE_RECENT_ACTIVITY",
          category: "history",
          label: transactions.length
            ? "Recent wallet activity inspected"
            : "No normal transactions returned",
          status: "info",
          claim: transactions.length
            ? `Shield inspected ${transactions.length} recent normal transactions; ${summary.failed} were marked failed.`
            : "The explorer returned no normal transactions for this wallet.",
          source: provider,
          method,
          rawValue: transactions.length,
          facts: {
            "Transactions inspected": transactions.length,
            Failed: summary.failed,
            Incoming: summary.incoming,
            Outgoing: summary.outgoing,
            "Latest activity": summary.latestAt,
          },
          referenceUrl: summary.latest
            ? `https://basescan.org/tx/${summary.latest.hash}`
            : addressExplorerUrl(address),
          limitations: [
            "Only the latest ten normal transactions were inspected.",
            "Recent activity does not prove that a wallet owner is trustworthy.",
          ],
        }),
      );
    } else {
      items.push(
        unavailableEvidence(
          context,
          "history",
          "EVIDENCE_RECENT_ACTIVITY",
          "Recent indexed activity unavailable",
          "Shield could not retrieve recent wallet transactions.",
          "indexed-provider-fallback",
          "account.txlist + Blockscout REST address-transactions fallback",
          explorerFailureLimitations(result.reason),
        ),
      );
    }

    items.push(
      unavailableEvidence(
        context,
        "exposure",
        "EVIDENCE_ACTIVE_APPROVALS",
        "Active approvals not checked",
        "Approval exposure requires indexed Approval events and live allowance checks.",
        "indexed-events + base-rpc",
        "Approval events + eth_call",
        ["No conclusion about token approvals was made by this scan."],
      ),
    );
  }

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
      "This version does not simulate transactions or inspect every historical event.",
      "Never share a private key or wallet recovery phrase with Shield.",
    ],
  };

  return {
    receiptId: createReceiptId(receiptWithoutId),
    ...receiptWithoutId,
  };
}
