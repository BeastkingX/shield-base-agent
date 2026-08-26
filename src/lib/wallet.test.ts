import { describe, expect, it, afterEach, vi } from "vitest";
import {
  ADDRESS_PATTERN,
  BASE_ADD_CHAIN,
  BASE_CHAIN_HEX,
  BASE_CHAIN_ID,
  WalletConnectError,
  connectWallet,
  describeChain,
  getInjectedWallet,
  isBaseChain,
  pickProvider,
  providerName,
  shortAddress,
  switchToBase,
  type Eip1193Provider,
} from "./wallet";

const WETH = "0x4200000000000000000000000000000000000006";

function metaMaskLike(): Eip1193Provider {
  return {
    isMetaMask: true,
    request: vi.fn(),
  } as unknown as Eip1193Provider;
}

function rabbyLike(): Eip1193Provider {
  return {
    isRabby: true,
    request: vi.fn(),
  } as unknown as Eip1193Provider;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shortAddress", () => {
  it("shortens a valid address with 0x + 6/6 style", () => {
    expect(shortAddress(WETH)).toBe("0x420000…000006");
  });

  it("passes through anything that is not a 0x address", () => {
    expect(shortAddress("not-an-address")).toBe("not-an-address");
    expect(shortAddress("")).toBe("");
  });

  it("accepts uppercase hex body with a lowercase 0x prefix", () => {
    const upper = `0x${WETH.slice(2).toUpperCase()}`;
    expect(shortAddress(upper)).toBe("0x420000…000006");
  });
});

describe("ADDRESS_PATTERN", () => {
  it("accepts 40 hex chars with 0x prefix", () => {
    expect(ADDRESS_PATTERN.test(WETH)).toBe(true);
    expect(ADDRESS_PATTERN.test(`0x${WETH.slice(2).toUpperCase()}`)).toBe(true);
  });

  it("rejects malformed values", () => {
    expect(ADDRESS_PATTERN.test(WETH.slice(2))).toBe(false);
    expect(ADDRESS_PATTERN.test(WETH.slice(0, -1))).toBe(false);
    expect(ADDRESS_PATTERN.test(`0x${"zz".repeat(20)}`)).toBe(false);
  });
});

describe("pickProvider", () => {
  it("prefers MetaMask when several providers are injected", () => {
    expect(pickProvider([rabbyLike(), metaMaskLike()])).toMatchObject({
      isMetaMask: true,
    });
  });

  it("falls back to the first provider", () => {
    expect(pickProvider([rabbyLike()])).toMatchObject({ isRabby: true });
  });

  it("returns null for an empty list", () => {
    expect(pickProvider([])).toBeNull();
  });
});

describe("providerName", () => {
  it("recognises common injected wallets", () => {
    expect(providerName(metaMaskLike())).toBe("MetaMask");
    expect(providerName(rabbyLike())).toBe("Rabby");
    expect(providerName({} as Eip1193Provider)).toBe("Wallet");
  });
});

describe("getInjectedWallet", () => {
  it("returns null when no wallet is installed", () => {
    vi.stubGlobal("window", {});
    expect(getInjectedWallet()).toBeNull();
  });

  it("reads the injected provider from window.ethereum", () => {
    const provider = metaMaskLike();
    vi.stubGlobal("window", { ethereum: provider });
    const result = getInjectedWallet();
    expect(result?.provider).toBe(provider);
    expect(result?.name).toBe("MetaMask");
  });

  it("unwraps a multi-provider array via pickProvider", () => {
    const metaMask = metaMaskLike();
    const rabby = rabbyLike();
    vi.stubGlobal("window", { ethereum: { providers: [rabby, metaMask] } });
    expect(getInjectedWallet()?.provider).toBe(metaMask);
  });
});

describe("chain helpers", () => {
  it("knows Base", () => {
    expect(BASE_CHAIN_ID).toBe(8453);
    expect(BASE_CHAIN_HEX).toBe("0x2105");
    expect(isBaseChain(BASE_CHAIN_ID)).toBe(true);
    expect(isBaseChain(1)).toBe(false);
    expect(describeChain(BASE_CHAIN_ID)).toBe("Base Mainnet");
    expect(describeChain(1)).toBe("Ethereum");
    expect(describeChain(999999)).toBe("Chain 999999");
  });

  it("ships Base add-chain params compatible with wallet_addEthereumChain", () => {
    expect(BASE_ADD_CHAIN.chainId).toBe("0x2105");
    expect(BASE_ADD_CHAIN.nativeCurrency.symbol).toBe("ETH");
    expect(BASE_ADD_CHAIN.rpcUrls[0]).toBe("https://mainnet.base.org");
  });
});

describe("connectWallet", () => {
  it("returns the account and chain for an injected wallet", async () => {
    const provider = metaMaskLike();
    vi.mocked(provider.request)
      .mockResolvedValueOnce([WETH])
      .mockResolvedValueOnce("0x2105");
    vi.stubGlobal("window", { ethereum: provider });

    const wallet = await connectWallet();
    expect(wallet.address).toBe(WETH.toLowerCase());
    expect(wallet.chainId).toBe(BASE_CHAIN_ID);
    expect(wallet.name).toBe("MetaMask");
    expect(provider.request).toHaveBeenCalledWith({
      method: "eth_requestAccounts",
    });
  });

  it("fails with NO_PROVIDER when no wallet is installed", async () => {
    vi.stubGlobal("window", {});
    await expect(connectWallet()).rejects.toMatchObject({
      name: "WalletConnectError",
      code: "NO_PROVIDER",
    });
  });

  it("maps a user rejection (4001) to REJECTED", async () => {
    const provider = metaMaskLike();
    vi.mocked(provider.request).mockRejectedValue({ code: 4001 });
    vi.stubGlobal("window", { ethereum: provider });
    await expect(connectWallet()).rejects.toBeInstanceOf(WalletConnectError);
    await expect(connectWallet()).rejects.toMatchObject({ code: "REJECTED" });
  });
});

describe("switchToBase", () => {
  it("requests a chain switch to Base", async () => {
    const provider = metaMaskLike();
    vi.mocked(provider.request).mockResolvedValue(null);
    await switchToBase(provider);
    expect(provider.request).toHaveBeenCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x2105" }],
    });
  });

  it("adds the network when the wallet does not know Base (4902)", async () => {
    const provider = metaMaskLike();
    vi.mocked(provider.request)
      .mockRejectedValueOnce({ code: 4902 })
      .mockResolvedValueOnce(null);
    await switchToBase(provider);
    expect(provider.request).toHaveBeenLastCalledWith({
      method: "wallet_addEthereumChain",
      params: [BASE_ADD_CHAIN],
    });
  });

  it("surfaces a user rejection as REJECTED", async () => {
    const provider = metaMaskLike();
    vi.mocked(provider.request).mockRejectedValue({ code: 4001 });
    await expect(switchToBase(provider)).rejects.toMatchObject({
      code: "REJECTED",
    });
  });
});
