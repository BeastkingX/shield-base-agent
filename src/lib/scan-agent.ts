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
import { parseEip7702Delegation } from "./eip7702";
import { formatEth, storageValueToAddress } from "./format";
import {
  getIndexedContractCreation,
  getIndexedRecentTransactions,
} from "./indexed-data";
import { fetchApprovalsForWallet, type ApprovalsSummary } from "./approvals";
import { analyzeClusterTaint, type ClusterAnalysis } from "./cluster-detector";
import { getKnown7702Delegate } from "./delegate-registry";
import { getThreatReport, type UnifiedThreatReport } from "./threat-intel";
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

  const providerDetail =
    error instanceof Error
      ? error.message.replace(/(?:proapi_|[A-Z0-9]{24,})[A-Za-z0-9_-]*/g, "[redacted]")
      : null;
  return [
    "Etherscan did not complete the verified-source metadata check.",
    ...(providerDetail ? [`Provider response: ${providerDetail}`] : []),
    "The failed check was not treated as a safe result.",
  ];
}

export function parseScanInput(input: unknown): Address {
  const result = inputSchema.safeParse(input);
  if (!result.success) {
    throw new ScanInputError(
      result.error.issues[0]?.message || "Invalid address supplied.",
    );
  }
  return result.data.address;
}

function createReceiptId(payload: object): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  return `shield_${digest.slice(0, 20)}`;
}

function summarizeTransactions(
  transactions: IndexedTransaction[],
  address: Address,
) {
  const normalized = address.toLowerCase();
  let failed = 0;
  let incoming = 0;
  let outgoing = 0;

  for (const transaction of transactions) {
    if (transaction.isError === "1" || transaction.txreceipt_status === "0") {
      failed += 1;
    }
    if (transaction.to?.toLowerCase() === normalized) {
      incoming += 1;
    }
    if (transaction.from.toLowerCase() === normalized) {
      outgoing += 1;
    }
  }

  return {
    failed,
    incoming,
    outgoing,
    latest: transactions[0] || null,
    latestAt: transactions[0]?.timeStamp
      ? new Date(Number(transactions[0].timeStamp) * 1000).toISOString()
      : null,
  };
}

async function getThreatFlags(
  targetAddress: Address,
): Promise<{ dangerHits: string[]; warnHits: string[]; dataSource: string } | null> {
  try {
    const gpUrl = `https://api.gopluslabs.io/api/v1/address_security/${targetAddress}?chain_id=8453`;
    const gpRes = await fetch(gpUrl, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
    // Safely handle non-JSON (GoPlus occasionally returns HTML on rate limit)
    let gp: any = null;
    try {
      const text = await gpRes.text();
      gp = text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
    if (gpRes.ok && gp?.code === 1 && gp?.result) {
      const r = gp.result as Record<string, string>;
      const dangerKeys = [
        "phishing_activities",
        "blacklist_doubt",
        "stealing_attack",
        "honeypot_related_address",
        "fake_kyc",
        "cybercrime",
      ];
      const warnKeys = [
        "money_laundering",
        "darkweb_transactions",
        "sanctioned",
        "mixer",
        "malicious_mining_activities",
        "gas_abuse",
        "financial_crime",
        "blackmail_activities",
        "fake_token",
        "number_of_malicious_contracts_created",
      ];
      const dangerHits = dangerKeys.filter((k) => r[k] === "1");
      const warnHits = warnKeys.filter((k) => r[k] === "1");
      return { dangerHits, warnHits, dataSource: r.data_source || "GoPlus Lab" };
    }
  } catch {}
  return null;
}

// Helper to race a promise against a timeout, returning a settled-like result
// so slow collectors become explicit unavailable evidence instead of a full 504.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export async function runShieldScan(address: Address): Promise<ScanReceipt> {
  const scannedAt = new Date().toISOString();
  let approvalsSummary: ApprovalsSummary | undefined;

  // Start cluster analysis in parallel with chain reads so a slow Blockscout
  // history for flagged addresses does not block the entire scan and cause
  // Vercel to return a non-JSON platform error.
  const clusterAnalysisPromise = analyzeClusterTaint(address);

  const [chainId, blockNumber] = await Promise.all([
    baseClient.getChainId(),
    baseClient.getBlockNumber(),
  ]);

  if (chainId !== 8453) {
    throw new Error(`Connected RPC returned chain ID ${chainId}, not Base mainnet.`);
  }

  // Run block + code + cluster analysis in parallel to stay inside Vercel's
  // maxDuration and avoid returning a non-JSON platform error for slow
  // flagged addresses like 0x00000c07575bb4e64457687a0382b4d3ea470000.
  const [block, code, clusterAnalysis] = await Promise.all([
    baseClient.getBlock({ blockNumber }),
    baseClient.getCode({ address, blockNumber }),
    clusterAnalysisPromise,
  ]);

  const normalizedCode = code || "0x";
  const delegationAddress = parseEip7702Delegation(normalizedCode);
  const isContract = normalizedCode !== "0x" && !delegationAddress;
  const targetType: TargetType = isContract ? "contract" : "wallet";
  const protocolPredeploy =
    targetType === "contract" ? getBaseProtocolContract(address) : null;
  const blockTimestamp = new Date(Number(block.timestamp) * 1000).toISOString();
  const context: EvidenceContext = { address, blockNumber, observedAt: scannedAt };
  const items: EvidenceItem[] = [];

  // EVIDENCE 1: Chain State
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
      limitations: [
        "The latest block can be reorganized in rare circumstances.",
      ],
    }),
  );

  // EVIDENCE 2: Target Type & EIP-7702
  if (delegationAddress) {
    const rawByteLength = (normalizedCode.length - 2) / 2;
    items.push(
      evidence(context, {
        id: "EVIDENCE_TARGET_TYPE",
        category: "identity",
        label: "EIP-7702 delegated wallet detected",
        status: "pass",
        claim: `The account code is an EIP-7702 delegation designator pointing to ${delegationAddress}.`,
        source: "base-rpc",
        method: "eth_getCode",
        rawValue: normalizedCode,
        facts: {
          Classification: "Delegated wallet (EIP-7702)",
          "Bytecode bytes": rawByteLength,
          "Delegation target": delegationAddress,
          "Delegation designator bytes": rawByteLength,
          "Execution semantics":
            "Calls execute the delegate address's code in this wallet's account context.",
          "Transaction origination":
            "This delegated wallet may still originate transactions.",
        },
        limitations: [
          "An EIP-7702 wallet can originate transactions while executing code delegated to another address.",
          "This scan identifies the delegation but does not yet analyze the delegate contract's behavior.",
          "Delegation is not by itself proof of safety or malicious behavior.",
        ],
      }),
    );
  } else if (targetType === "contract") {
    items.push(
      evidence(context, {
        id: "EVIDENCE_TARGET_TYPE",
        category: "identity",
        label: "Smart contract detected",
        status: "pass",
        claim: "Deployed bytecode existed at this address at the scanned block.",
        source: "base-rpc",
        method: "eth_getCode",
        rawValue: `bytecodeBytes=${(normalizedCode.length - 2) / 2}`,
        facts: {
          Classification: "Smart contract",
          "Bytecode bytes": (normalizedCode.length - 2) / 2,
        },
        limitations: [
          "Bytecode presence proves contract deployment, not safety or source verification.",
        ],
      }),
    );
  } else {
    items.push(
      evidence(context, {
        id: "EVIDENCE_TARGET_TYPE",
        category: "identity",
        label: "No deployed bytecode detected",
        status: "pass",
        claim: "No contract bytecode was deployed at this address at the scanned block.",
        source: "base-rpc",
        method: "eth_getCode",
        rawValue: null,
        facts: {
          Classification: "Standard EOA wallet",
          "Bytecode bytes": 0,
        },
        limitations: [
          "An address with no code can still be controlled by an automated system or private-key holder.",
          "Absence of code does not prove that a wallet owner is trustworthy.",
        ],
      }),
    );
  }

  const [balance, txCount, eip1967Storage] = await Promise.all([
    baseClient.getBalance({ address, blockNumber }),
    baseClient.getTransactionCount({ address, blockNumber }),
    targetType === "contract"
      ? baseClient.getStorageAt({
          address,
          slot: EIP1967_IMPLEMENTATION_SLOT,
          blockNumber,
        })
      : Promise.resolve(null),
  ]);

  // EVIDENCE 3: Native Balance
  items.push(
    evidence(context, {
      id: "EVIDENCE_NATIVE_BALANCE",
      category: "chain",
      label: "Native balance read",
      status: "info",
      claim: `The address held ${formatEth(balance)} at the scanned block.`,
      source: "base-rpc",
      method: "eth_getBalance",
      rawValue: balance.toString(),
      facts: {
        "Native balance": formatEth(balance),
      },
      limitations: ["Token balances are not included in this value."],
    }),
  );

  // EVIDENCE 4: Transaction Count
  items.push(
    evidence(context, {
      id: "EVIDENCE_TRANSACTION_COUNT",
      category: "history",
      label: "Transaction count read",
      status: "info",
      claim: `The address had transaction count ${txCount} at the scanned block.`,
      source: "base-rpc",
      method: "eth_getTransactionCount",
      rawValue: txCount,
      facts: {
        "Transaction count": txCount,
      },
      limitations: [
        targetType === "contract"
          ? "For contracts, this value does not describe the contract's full interaction history."
          : delegationAddress
            ? "For delegated wallets, this count does not describe every call executed through delegated code."
            : "Transaction count alone cannot establish trust.",
      ],
    }),
  );

  // CONTRACT PATH – honest partial-mode rescue with parallel collectors
  if (targetType === "contract") {
    const implementationAddress = storageValueToAddress(eip1967Storage ?? undefined);
    items.push(
      evidence(context, {
        id: "EVIDENCE_PROXY_IMPLEMENTATION",
        category: "identity",
        label: implementationAddress
          ? "Standard proxy implementation slot identified"
          : "No EIP-1967 implementation found",
        status: "pass",
        claim: implementationAddress
          ? `The EIP-1967 implementation slot contained ${implementationAddress}.`
          : "The EIP-1967 implementation slot did not contain an implementation address; other proxy patterns remain possible.",
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

    const sourceMetaPromise = withTimeout(
      getContractSourceMetadata(address),
      6000,
      "source metadata",
    );
    const creationPromise = protocolPredeploy
      ? Promise.resolve(null)
      : withTimeout(getIndexedContractCreation(address), 7000, "contract creation");
    const historyPromise = withTimeout(
      getIndexedRecentTransactions(address),
      7000,
      "recent activity",
    );

    const [sourceResult, creationResult, historyResult] = await Promise.allSettled([
      sourceMetaPromise,
      creationPromise,
      historyPromise,
    ]);

    const sourceRes = sourceResult as PromiseSettledResult<any>;
    if (sourceRes.status === "fulfilled") {
      const source = sourceRes.value;
      const isVerified = source.verified;
      const explorerReportsProxy = source.Proxy === "1";
      items.push(
        evidence(context, {
          id: "EVIDENCE_CONTRACT_VERIFICATION",
          category: "identity",
          label: explorerReportsProxy
            ? isVerified
              ? "Published source verified; proxy reported"
              : "Source unverified; proxy reported"
            : isVerified
              ? "Published source code verified"
              : "No verified source code published",
          status: isVerified ? "pass" : "warning",
          claim: explorerReportsProxy
            ? isVerified
              ? `${source.ContractName || "The contract"} has verified source metadata, and BaseScan reports this address as a proxy.`
              : "BaseScan did not return published, verified source code and reports this address as a proxy."
            : isVerified
              ? `${source.ContractName || "The contract"} has published source metadata indexed by BaseScan.`
              : "No verified source code was found on the block explorer.",
          source: "etherscan-v2",
          method: "contract.getsourcecode",
          rawValue: isVerified,
          facts: {
            Verified: isVerified,
            "Contract name": source.ContractName || "Not published",
            Compiler: source.CompilerVersion || "Not published",
            License: source.LicenseType || "Not published",
            "Explorer proxy flag": explorerReportsProxy,
            Implementation: source.Implementation || implementationAddress,
          },
          referenceUrl: `${addressExplorerUrl(address)}#code`,
          limitations: [
            "Published source improves transparency but is not a security audit.",
            "Verified code can still contain vulnerabilities or harmful behavior.",
            ...(explorerReportsProxy
              ? [
                  "A proxy is not automatically malicious, but its implementation may be upgradeable or controlled separately.",
                  "Explorer proxy metadata is indexed evidence and should be checked against live storage and governance controls.",
                ]
              : []),
          ],
        }),
      );
    } else {
      items.push(
        unavailableEvidence(
          context,
          "identity",
          "EVIDENCE_CONTRACT_VERIFICATION",
          "Contract verification status unavailable",
          "Shield could not inspect verified source metadata.",
          "etherscan-v2",
          "contract.getsourcecode",
          sourceMetadataFailureLimitations(sourceRes.reason),
        ),
      );
    }

    if (protocolPredeploy) {
      items.push(
        evidence(context, {
          id: "EVIDENCE_CONTRACT_CREATION",
          category: "history",
          label: "Official protocol predeploy identified",
          status: "pass",
          claim: `${protocolPredeploy.name} matches the exact Base registry address and is specified as an OP Stack protocol predeploy.`,
          source: "base-official-registry",
          method: "exact address match + OP Stack predeploy specification",
          rawValue: `protocol-predeploy:${protocolPredeploy.name}`,
          facts: {
            Contract: protocolPredeploy.name,
            "Deployment mechanism": "Protocol predeploy",
            "Ordinary creation transaction": "Not applicable",
            "Official address match": true,
            Introduced: protocolPredeploy.introduced,
            "Proxied by specification": protocolPredeploy.proxied,
            "Protocol specification": protocolPredeploy.protocolSpecificationUrl,
          },
          referenceUrl: protocolPredeploy.baseRegistryUrl,
          limitations: [
            "Protocol predeploys are initialized in network state rather than through an ordinary user-submitted transaction.",
          ],
        }),
      );
    } else {
      const creationRes = creationResult as PromiseSettledResult<any>;
      if (creationRes.status === "fulfilled" && creationRes.value) {
        const { data: creation, provider } = creationRes.value;
        items.push(
          evidence(context, {
            id: "EVIDENCE_CONTRACT_CREATION",
            category: "history",
            label: "Contract creation traced",
            status: "info",
            claim: `The contract was created by ${creation.contractCreator}.`,
            source: provider,
            method: "contract.getcontractcreation",
            rawValue: creation.txHash,
            facts: {
              Creator: creation.contractCreator,
              "Creation transaction": creation.txHash,
            },
            referenceUrl: `https://basescan.org/tx/${creation.txHash}`,
            limitations: ["Contract age alone does not establish safety."],
          }),
        );
      } else {
        const reason = creationRes.status === "rejected" ? creationRes.reason : new Error("creation unavailable");
        items.push(
          unavailableEvidence(
            context,
            "history",
            "EVIDENCE_CONTRACT_CREATION",
            "Contract creation metadata unavailable",
            "Shield could not retrieve the contract's creation transaction.",
            "indexed-provider-fallback",
            "contract.getcontractcreation",
            explorerFailureLimitations(reason),
          ),
        );
      }
    }

    const historyRes = historyResult as PromiseSettledResult<any>;
    if (historyRes.status === "fulfilled") {
      const { data: transactions, provider, method } = historyRes.value;
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
            ? `Shield inspected ${transactions.length} recent normal transactions; ${summary.failed} were marked failed.`
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
          },
          referenceUrl: summary.latest
            ? `https://basescan.org/tx/${summary.latest.hash}`
            : addressExplorerUrl(address),
          limitations: [
            "Only the latest ten normal transactions were inspected.",
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
          explorerFailureLimitations(historyRes.reason),
        ),
      );
    }
  } else {
    // WALLET PATH – honest partial-mode rescue: run history, approvals, threat intel in parallel
    const historyPromise = withTimeout(
      getIndexedRecentTransactions(address),
      7000,
      "recent activity",
    );
    const approvalsPromise = withTimeout(
      fetchApprovalsForWallet(address),
      5000,
      "approvals",
    );
    const threatPromise = withTimeout(
      getThreatReport(address),
      6000,
      "threat intel",
    );

    const [historySettled, approvalsSettled, threatSettled] = await Promise.allSettled([
      historyPromise,
      approvalsPromise,
      threatPromise,
    ]);

    // Process history – preserve recent-window when earliest fails
    const walletHistoryRes = historySettled as PromiseSettledResult<any>;
    if (walletHistoryRes.status === "fulfilled") {
      const { data: transactions, provider, method } = walletHistoryRes.value;
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
    } else if (txCount > 0) {
      items.push(
        evidence(context, {
          id: "EVIDENCE_RECENT_ACTIVITY",
          category: "history",
          label: `Active wallet history verified (${txCount} txs)`,
          status: "info",
          claim: `Shield verified on-chain account history: ${txCount} originated transactions on Base with ${formatEth(balance)} balance.`,
          source: "base-rpc",
          method: "eth_getTransactionCount + eth_getBalance",
          rawValue: txCount,
          facts: {
            "Transaction count / Nonce": txCount,
            "Current Balance": formatEth(balance),
            "Account Status": "Active EOA",
          },
          limitations: [
            "RPC nonce reflects total originated transactions on Base.",
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
          explorerFailureLimitations(walletHistoryRes.reason),
        ),
      );
    }

    // Process approvals – honest partial, never invent clean if timed out
    if (approvalsSettled.status === "fulfilled") {
      approvalsSummary = approvalsSettled.value as ApprovalsSummary;
    } else {
      approvalsSummary = {
        approvals: [],
        totalCount: 0,
        unlimitedCount: 0,
        highRiskCount: 0,
        uniqueTokensCount: 0,
        uniqueSpendersCount: 0,
      };
    }

    const hasApprovals = approvalsSummary && approvalsSummary.totalCount > 0;
    const hasHighRiskSpender = approvalsSummary && approvalsSummary.highRiskCount > 0;

    if (approvalsSettled.status === "rejected") {
      items.push(
        unavailableEvidence(
          context,
          "exposure",
          "EVIDENCE_ACTIVE_APPROVALS",
          "Active approvals check timed out",
          "Shield could not complete the token approval audit within the time budget; this check is an explicit gap, not a pass.",
          "blockscout-approval-index + base-rpc",
          "Approval events + allowance probe",
          ["Approval scan timed out; absence was not treated as safe."],
        ),
      );
    } else if (hasApprovals) {
      items.push(
        evidence(context, {
          id: "EVIDENCE_ACTIVE_APPROVALS",
          category: "exposure",
          label: `Active approvals audited (${approvalsSummary.totalCount} active, ${approvalsSummary.unlimitedCount} unlimited)`,
          status: hasHighRiskSpender ? "danger" : approvalsSummary.unlimitedCount >= 5 ? "warning" : approvalsSummary.unlimitedCount > 0 ? "info" : "pass",
          claim: `Shield indexed ${approvalsSummary.totalCount} active token approvals across ${approvalsSummary.uniqueTokensCount} tokens (${approvalsSummary.unlimitedCount} unlimited allowances).`,
          source: "blockscout-approval-index + base-rpc",
          method: "Approval events + allowance probe",
          rawValue: approvalsSummary.totalCount,
          facts: {
            "Total active approvals": approvalsSummary.totalCount,
            "Unlimited allowances": approvalsSummary.unlimitedCount,
            "Unique tokens": approvalsSummary.uniqueTokensCount,
            "Unique spenders": approvalsSummary.uniqueSpendersCount,
            "High-risk spenders": approvalsSummary.highRiskCount,
          },
          limitations: [
            "Token approvals allow external contracts to transfer tokens up to the approved allowance.",
            "Users should regularly audit and revoke allowances for inactive dApps.",
          ],
        }),
      );
    } else {
      items.push(
        evidence(context, {
          id: "EVIDENCE_ACTIVE_APPROVALS",
          category: "exposure",
          label: "No open token approvals detected",
          status: "pass",
          claim: "Shield audited token approval events on Base; no open unlimited token allowances detected for this wallet.",
          source: "base-rpc + indexed-events",
          method: "Approval events + eth_call",
          rawValue: 0,
          facts: {
            "Total active approvals": 0,
            "Unlimited allowances": 0,
            "Exposure Status": "Clean / Zero open approvals",
          },
          limitations: [
            "Approval scans evaluate token allowances on Base mainnet.",
          ],
        }),
      );
    }

    // EIP-7702 Delegate Bounded 1-Hop Evaluation – with timeouts
    if (delegationAddress) {
      try {
        const [delegateCode, delegateSourceRes, delegateCreationRes, delegateThreat] =
          await Promise.allSettled([
            withTimeout(baseClient.getCode({ address: delegationAddress, blockNumber }), 5000, "delegate code"),
            withTimeout(getContractSourceMetadata(delegationAddress), 5000, "delegate source"),
            withTimeout(getIndexedContractCreation(delegationAddress), 5000, "delegate creation"),
            withTimeout(getThreatFlags(delegationAddress), 5000, "delegate threat"),
          ]);

        const knownDelegate = getKnown7702Delegate(delegationAddress);
        const isVerifiedSource =
          delegateSourceRes.status === "fulfilled" &&
          delegateSourceRes.value &&
          delegateSourceRes.value.verified;
        const contractName =
          (delegateSourceRes.status === "fulfilled" && delegateSourceRes.value?.ContractName) ||
          knownDelegate?.name ||
          "Unlabeled Delegate";
        const creator =
          delegateCreationRes.status === "fulfilled"
            ? delegateCreationRes.value?.data?.contractCreator
            : "Unknown";

        let creatorActivity = "Unknown";
        if (creator && isAddress(creator)) {
          try {
            const cNonce = await withTimeout(
              baseClient.getTransactionCount({
                address: creator as Address,
                blockNumber,
              }),
              4000,
              "creator nonce",
            );
            creatorActivity = `${cNonce} sent transactions`;
          } catch {}
        }

        const hasDangerThreat =
          delegateThreat.status === "fulfilled" &&
          delegateThreat.value &&
          delegateThreat.value.dangerHits.length > 0;

        let delegateStatus: EvidenceItem["status"] = "pass";
        let claim = `This wallet delegates execution to verified contract ${delegationAddress} (${contractName}).`;

        if (hasDangerThreat) {
          delegateStatus = "danger";
          claim = `CRITICAL: The delegated execution contract ${delegationAddress} is flagged for malicious threat activity (${delegateThreat.value?.dangerHits.join(", ")}).`;
        } else if (!isVerifiedSource && !knownDelegate) {
          delegateStatus = "warning";
          claim = `This wallet delegates all execution to contract ${delegationAddress}. Its code (not the wallet's) runs on every transfer here. The delegate has no verified source and is not a recognized smart-account implementation; treat the wallet as carrying the risk of that contract.`;
        }

        items.push(
          evidence(context, {
            id: "EVIDENCE_7702_DELEGATE",
            category: "identity",
            label:
              delegateStatus === "danger"
                ? `Malicious 7702 delegate contract flagged`
                : delegateStatus === "warning"
                ? `Unverified 7702 delegate contract evaluated`
                : `Verified 7702 delegate evaluated (${contractName})`,
            status: delegateStatus,
            claim,
            source: "base-rpc + etherscan-v2 + goplus",
            method: "Bounded 1-hop delegate bytecode, source verification & threat check",
            rawValue: isVerifiedSource || Boolean(knownDelegate),
            facts: {
              "Delegate address": delegationAddress,
              "Verified source": isVerifiedSource ? "Yes" : "No",
              "Contract name": contractName,
              "Framework / Registry": knownDelegate?.framework || "Custom / Unknown",
              Creator: creator || "Unknown",
              "Delegate creator activity": creatorActivity,
              "Threat flags":
                delegateThreat.status === "fulfilled" && delegateThreat.value?.dangerHits.length
                  ? delegateThreat.value.dangerHits.join(", ")
                  : "none",
            },
            referenceUrl: addressExplorerUrl(delegationAddress),
            limitations: [
              "Depth capped at 1: only the delegate itself is evaluated; code it calls internally is out of scope for this check.",
              "Every wallet delegated to this contract shares this risk.",
            ],
          }),
        );
      } catch (delegateError) {
        items.push(
          unavailableEvidence(
            context,
            "identity",
            "EVIDENCE_7702_DELEGATE",
            "7702 delegate evaluation unavailable",
            "Shield could not inspect metadata for the delegate contract at scan time.",
            "base-rpc + etherscan-v2",
            "contract.getsourcecode + eth_getCode",
            ["Explorer failure prevented delegate inspection; this is an explicit gap, not a pass."],
          ),
        );
      }
    }

    // Store threat result for later processing after money trail
    (globalThis as any).__shield_threatSettled = threatSettled;
  }

  // Money Trail & Sweep Velocity, measured on every scan – already has partial rescue for earliest window
  if (clusterAnalysis.analysisStatus === "unavailable") {
    items.push(
      evidence(context, {
        id: "EVIDENCE_MONEY_TRAIL",
        category: "history",
        label: "Money-trail analysis unavailable",
        status: "unavailable",
        claim:
          "Indexed transaction history could not be read at scan time; money-trail and sweep-velocity checks did not run.",
        source: "shield-cluster-traversal",
        method:
          "Seed funder + dominant outflow hub + deposit-to-forward delta timing (Blockscout txlist)",
        rawValue: "unavailable",
        limitations: [
          "Explorer downtime prevents flow analysis; this is an explicit gap, not a pass.",
        ],
      }),
    );
  } else if (clusterAnalysis.isSweeperActive && clusterAnalysis.taintSeverity === "critical") {
    items.push(
      evidence(context, {
        id: "EVIDENCE_SWEEPER_BOT_ANALYSIS",
        category: "history",
        label: `Measured rapid-sweep pattern (median ${clusterAnalysis.sweepVelocitySeconds}s)`,
        status: "danger",
        claim: `Measured median deposit-to-forward time of ${clusterAnalysis.sweepVelocitySeconds} seconds across ${clusterAnalysis.velocitySamples} deposit(s); seed funder ${clusterAnalysis.seedFunder}; dominant outflow hub ${clusterAnalysis.sweepDestination}.`,
        source: "shield-velocity-detector",
        method: "Deposit-to-forward delta timing over indexed history",
        rawValue: true,
        facts: {
          "Median sweep time (s)": clusterAnalysis.sweepVelocitySeconds,
          "Velocity samples": clusterAnalysis.velocitySamples,
          "Seed funder": clusterAnalysis.seedFunder,
          "Funder profile": clusterAnalysis.funderProfile,
          "Dominant hub": clusterAnalysis.sweepDestination,
          "Hub profile": clusterAnalysis.hubProfile,
          "Sampled transactions": clusterAnalysis.sampledTransactions,
        },
        limitations: [
          "Behavioral evidence measures forwarding speed and fund flows; it does not prove key compromise by itself.",
          "A key leaked with zero on-chain activity cannot be detected until a sweep occurs.",
        ],
      }),
    );
  } else if (clusterAnalysis.taintSeverity === "critical") {
    items.push(
      evidence(context, {
        id: "EVIDENCE_MONEY_TRAIL_CLUSTER",
        category: "history",
        label: `Measured laundering-pattern flow (${clusterAnalysis.clusterTaintName})`,
        status: "danger",
        claim: `Sampled fund flows connect this address to a measured cluster pattern. Seed funder: ${clusterAnalysis.seedFunder}. Dominant outflow hub: ${clusterAnalysis.sweepDestination}.`,
        source: "shield-cluster-traversal",
        method: "1-hop upstream seed funder + 1-hop downstream hub profiling",
        rawValue: clusterAnalysis.clusterTaintName,
        facts: {
          "Seed funder": clusterAnalysis.seedFunder,
          "Funder profile": clusterAnalysis.funderProfile,
          "Dominant hub": clusterAnalysis.sweepDestination,
          "Hub profile": clusterAnalysis.hubProfile,
          "Hop-2 funder": clusterAnalysis.hop2Funder ?? "not observed",
        },
        limitations: [
          "Analysis covers sampled transaction windows; older history may be out of scope.",
        ],
      }),
    );
  } else if (clusterAnalysis.taintSeverity === "warning") {
    items.push(
      evidence(context, {
        id: "EVIDENCE_MONEY_TRAIL_CLUSTER",
        category: "history",
        label: "Automated forwarding measured (unattributed)",
        status: "warning",
        claim: `Deposits are forwarded quickly (median ${clusterAnalysis.sweepVelocitySeconds}s over ${clusterAnalysis.velocitySamples} sample(s)), but no dispenser-funder or aggregation-hub pattern was measured. Legitimate services (e.g. exchange deposit wallets) can show the same shape.`,
        source: "shield-velocity-detector",
        method: "Deposit-to-forward delta timing over indexed history",
        rawValue: clusterAnalysis.sweepVelocitySeconds,
        facts: {
          "Median forward time (s)": clusterAnalysis.sweepVelocitySeconds,
          "Samples": clusterAnalysis.velocitySamples,
          "Top outflow destination": clusterAnalysis.sweepDestination,
        },
        limitations: [
          "Fast forwarding alone does not prove malicious intent.",
        ],
      }),
    );
  } else {
    items.push(
      evidence(context, {
        id: "EVIDENCE_MONEY_TRAIL",
        category: "history",
        label: "Money-trail analysis completed, no rapid-forwarding pattern measured",
        status: "pass",
        claim: `Shield sampled ${clusterAnalysis.sampledTransactions} transaction(s), identified the seed funder (${clusterAnalysis.seedFunder}), and measured deposit-to-forward timing. No sweeper or cluster pattern was detected in the sampled history.`,
        source: "shield-cluster-traversal",
        method: "1-hop upstream + 1-hop downstream + delta timing (Blockscout txlist)",
        rawValue: "no-pattern-measured",
        facts: {
          "Seed funder": clusterAnalysis.seedFunder,
          "Funder profile": clusterAnalysis.funderProfile,
          "Top outflow destination": clusterAnalysis.sweepDestination,
          "Velocity samples": clusterAnalysis.velocitySamples,
          "Sampled transactions": clusterAnalysis.sampledTransactions,
        },
        limitations: [
          "A threat with no on-chain history cannot be detected by flow analysis.",
        ],
      }),
    );
  }

  // Third-party threat intelligence – wallet path uses parallel result, contract path fetches fresh
  if (targetType === "wallet") {
    const threatSettled = (globalThis as any).__shield_threatSettled as PromiseSettledResult<any> | undefined;
    delete (globalThis as any).__shield_threatSettled;

    if (threatSettled) {
      if (threatSettled.status === "fulfilled") {
        try {
          const threatReport = threatSettled.value as UnifiedThreatReport;
          if (threatReport.overallStatus === "unavailable") {
            throw new Error("All threat intelligence providers were unavailable");
          }
          const dangerList = threatReport.dangerFlags;
          const cautionList = threatReport.cautionFlags;
          items.push(
            evidence(context, {
              id: "EVIDENCE_THREAT_INTEL",
              category: "history",
              label: dangerList.length
                ? `Threat-intel match: ${dangerList.join(", ")}`
                : cautionList.length
                  ? `Threat-intel caution flags: ${cautionList.join(", ")}`
                  : "No third-party threat-intel flags",
              status: threatReport.overallStatus,
              claim: dangerList.length
                ? `Threat intelligence flagged this address across ${dangerList.length} source/category: ${dangerList.join(", ")}.`
                : cautionList.length
                  ? `Threat intelligence flags caution categories: ${cautionList.join(", ")}.`
                  : "No threats listed across 3 independent threat intelligence sources (GoPlus Base, GoPlus Ethereum, ScamSniffer DB).",
              source: "threat-intel-union",
              method: "GoPlus (Base + Ethereum) + ScamSniffer DB",
              rawValue: dangerList.length + cautionList.length,
              facts: {
                "GoPlus (Base)": threatReport.goplusBase.detail,
                "GoPlus (Ethereum)": threatReport.goplusEth.detail,
                "ScamSniffer DB":
                  threatReport.scamsniffer === "listed"
                    ? "Blacklisted Phishing/Drainer"
                    : threatReport.scamsniffer === "not-listed"
                      ? "Not listed"
                      : "Unavailable",
                "Sources checked": `${threatReport.sourcesChecked}/3 providers`,
              },
              referenceUrl: "https://gopluslabs.io/",
              limitations: [
                "Third-party threat lists can lag fresh attackers and may contain stale or disputed entries; a flag is a strong signal, not proof, and a clean result is not a guarantee.",
              ],
            }),
          );
        } catch {
          items.push(
            unavailableEvidence(
              context,
              "history",
              "EVIDENCE_THREAT_INTEL",
              "Threat-intel check unavailable",
              "The third-party threat-intel provider could not be queried at scan time; this check is an explicit gap, not a pass.",
              "threat-intel-union",
              "GoPlus (Base + Ethereum) + ScamSniffer DB",
              ["No threat-intel data was available; absence of evidence was not treated as evidence."],
            ),
          );
        }
      } else {
        items.push(
          unavailableEvidence(
            context,
            "history",
            "EVIDENCE_THREAT_INTEL",
            threatSettled.reason?.message?.includes("timed out")
              ? "Threat-intel check timed out"
              : "Threat-intel check unavailable",
            threatSettled.reason?.message?.includes("timed out")
              ? "Threat-intel providers did not respond within the time budget; this check is an explicit gap, not a pass."
              : "The third-party threat-intel provider could not be queried at scan time; this check is an explicit gap, not a pass.",
            "threat-intel-union",
            "GoPlus (Base + Ethereum) + ScamSniffer DB",
            [
              threatSettled.reason?.message?.includes("timed out")
                ? `Provider timeout: ${threatSettled.reason.message}`
                : "No threat-intel data was available; absence of evidence was not treated as evidence.",
            ],
          ),
        );
      }
    }
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
    clusterAnalysis,
    approvalsSummary,
  };

  const receiptHash = `0x${createHash("sha256")
    .update(JSON.stringify(receiptWithoutId))
    .digest("hex")}`;

  return {
    receiptId: createReceiptId(receiptWithoutId),
    receiptHash,
    ...receiptWithoutId,
  };
}
