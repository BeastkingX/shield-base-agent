/**
 * Minimal EIP-1193 wallet integration for Shield.
 *
 * Shield is strictly read-only: it connects to an injected wallet
 * (MetaMask, Rabby, Coinbase Wallet, ...) to learn the account address,
 * then scans that address with the evidence engine. It never requests a
 * signature and never sends a transaction.
 *
 * All window access happens inside functions so this module stays safe
 * for server-side rendering and unit tests.
 */

export const BASE_CHAIN_ID = 8453;
export const BASE_CHAIN_HEX = "0x2105";

export interface Eip1193Provider {
  request(args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
  providers?: Eip1193Provider[];
}

export interface ConnectedWallet {
  address: string;
  chainId: number;
  provider: Eip1193Provider;
  name: string;
}

export type WalletErrorCode =
  | "NO_PROVIDER"
  | "NO_ACCOUNT"
  | "REJECTED"
  | "UNSUPPORTED_NETWORK"
  | "UNKNOWN";

export class WalletConnectError extends Error {
  constructor(public readonly code: WalletErrorCode) {
    super(code);
    this.name = "WalletConnectError";
  }
}

export const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** "0x1234567890abcdef...123456" -> "0x12345678…123456" */
export function shortAddress(value: string): string {
  if (!ADDRESS_PATTERN.test(value)) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

/**
 * When several injected providers share window.ethereum (e.g. MetaMask +
 * Rabby), prefer MetaMask, otherwise take the first available provider.
 */
export function pickProvider(
  providers: readonly Eip1193Provider[],
): Eip1193Provider | null {
  if (providers.length === 0) return null;
  return providers.find((provider) => provider.isMetaMask) ?? providers[0];
}

export function providerName(provider: Eip1193Provider): string {
  const flags = provider as unknown as Record<string, unknown>;
  if (flags.isMetaMask) return "MetaMask";
  if (flags.isRabby) return "Rabby";
  if (flags.isCoinbaseWallet) return "Coinbase Wallet";
  if (flags.isFrame) return "Frame";
  if (flags.isOKX) return "OKX Wallet";
  if (flags.isTrust) return "Trust Wallet";
  return "Wallet";
}

/** Returns the injected wallet provider, or null when none is available. */
export function getInjectedWallet(): {
  provider: Eip1193Provider;
  name: string;
} | null {
  if (typeof window === "undefined") return null;
  const ethereum = (window as unknown as { ethereum?: Eip1193Provider })
    .ethereum;
  if (!ethereum) return null;
  const provider = Array.isArray(ethereum.providers)
    ? pickProvider(ethereum.providers)
    : ethereum;
  if (!provider) return null;
  return { provider, name: providerName(provider) };
}

export async function getChainId(provider: Eip1193Provider): Promise<number> {
  const hex = await provider.request({ method: "eth_chainId" });
  return Number.parseInt(String(hex), 16);
}

/**
 * Requests the connected account(s). Throws WalletConnectError with a
 * friendly code when no wallet is installed or the user declines.
 */
export async function connectWallet(): Promise<ConnectedWallet> {
  const injected = getInjectedWallet();
  if (!injected) throw new WalletConnectError("NO_PROVIDER");
  const { provider, name } = injected;

  let accounts: unknown;
  try {
    accounts = await provider.request({ method: "eth_requestAccounts" });
  } catch (caught) {
    if ((caught as { code?: number }).code === 4001) {
      throw new WalletConnectError("REJECTED");
    }
    throw new WalletConnectError("UNKNOWN");
  }

  const first = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof first !== "string" || !ADDRESS_PATTERN.test(first)) {
    throw new WalletConnectError("NO_ACCOUNT");
  }

  const chainId = await getChainId(provider);
  return { address: first.toLowerCase(), chainId, provider, name };
}

export function isBaseChain(chainId: number): boolean {
  return chainId === BASE_CHAIN_ID;
}

export function describeChain(chainId: number): string {
  const known: Record<number, string> = {
    1: "Ethereum",
    10: "OP Mainnet",
    137: "Polygon",
    42161: "Arbitrum One",
    84532: "Base Sepolia",
    11155111: "Sepolia",
  };
  if (chainId === BASE_CHAIN_ID) return "Base Mainnet";
  return known[chainId] ?? `Chain ${chainId}`;
}

export const BASE_ADD_CHAIN = {
  chainId: BASE_CHAIN_HEX,
  chainName: "Base Mainnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
} as const;

/**
 * Asks the wallet to switch to Base Mainnet, adding the network first when
 * the wallet does not know it yet (provider error 4902).
 */
export async function switchToBase(provider: Eip1193Provider): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_CHAIN_HEX }],
    });
  } catch (caught) {
    const code = (caught as { code?: number }).code;
    if (code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [BASE_ADD_CHAIN],
      });
      return;
    }
    if (code === 4001) throw new WalletConnectError("REJECTED");
    throw new WalletConnectError("UNSUPPORTED_NETWORK");
  }
}
