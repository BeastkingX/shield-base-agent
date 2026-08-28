"use client";

import { useCallback, useEffect, useState } from "react";
import {
  connectWallet,
  describeChain,
  getInjectedWallet,
  isBaseChain,
  shortAddress,
  switchToBase,
  WalletConnectError,
  type Eip1193Provider,
} from "@/lib/wallet";

interface WalletPanelProps {
  /** Called with the connected account whenever Shield should scan it. */
  onAddress: (address: string) => void;
  /** Called when the user disconnects locally. */
  onDisconnect: () => void;
  /** True while a scan is running (disables the panel actions). */
  scanning: boolean;
  /** Called when the user clicks Protected Send */
  onOpenSendModal?: () => void;
}

type WalletStatus = "checking" | "idle" | "connecting" | "connected" | "unsupported";

export default function WalletPanel({
  onAddress,
  onDisconnect,
  scanning,
  onOpenSendModal,
}: WalletPanelProps) {
  const [status, setStatus] = useState<WalletStatus>("checking");
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState(0);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<Eip1193Provider | null>(null);
  const [switching, setSwitching] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const injected = getInjectedWallet();
      if (!injected) {
        setStatus("unsupported");
        return;
      }

      setStatus("idle");

      const onAccountsChanged = (accounts: unknown) => {
        const first = Array.isArray(accounts) ? accounts[0] : undefined;
        if (typeof first === "string" && /^0x[0-9a-fA-F]{40}$/.test(first)) {
          const account = first.toLowerCase();
          setAddress(account);
          setStatus("connected");
          setProvider(injected.provider);
          setName(injected.name);
          onAddress(account);
        } else {
          setAddress("");
          setStatus("idle");
        }
      };

      const onChainChanged = (hex: unknown) => {
        const id = Number.parseInt(String(hex), 16);
        if (Number.isFinite(id)) setChainId(id);
      };

      injected.provider.on?.("accountsChanged", onAccountsChanged);
      injected.provider.on?.("chainChanged", onChainChanged);
      dispose = () => {
        injected.provider.removeListener?.("accountsChanged", onAccountsChanged);
        injected.provider.removeListener?.("chainChanged", onChainChanged);
      };
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      dispose?.();
    };
  }, [onAddress]);

  const handleConnect = useCallback(async () => {
    setStatus("connecting");
    setError("");
    try {
      const wallet = await connectWallet();
      setProvider(wallet.provider);
      setAddress(wallet.address);
      setChainId(wallet.chainId);
      setName(wallet.name);
      setStatus("connected");
      onAddress(wallet.address);
    } catch (caught) {
      setStatus(getInjectedWallet() ? "idle" : "unsupported");
      setError(
        caught instanceof WalletConnectError && caught.code === "REJECTED"
          ? "The connection request was declined in your wallet."
          : "The wallet could not be reached. Make sure your wallet extension is unlocked.",
      );
    }
  }, [onAddress]);

  const handleSwitchToBase = useCallback(async () => {
    if (!provider) return;
    setSwitching(true);
    setError("");
    try {
      await switchToBase(provider);
    } catch {
      setError("Could not switch the network in your wallet.");
    } finally {
      setSwitching(false);
    }
  }, [provider]);

  const handleDisconnect = useCallback(() => {
    setAddress("");
    setChainId(0);
    setProvider(null);
    setError("");
    setStatus("idle");
    onDisconnect();
  }, [onDisconnect]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [address]);

  if (status === "checking") {
    return (
      <div className="walletSlimRow">
        <span className="walletNoteText">Checking wallet provider…</span>
      </div>
    );
  }

  if (status === "unsupported") {
    return (
      <div className="walletSlimRow">
        <span className="walletNoteText">
          Connect your wallet extension (MetaMask, Coinbase Wallet, Rabby) to scan your address automatically.
        </span>
      </div>
    );
  }

  if (status !== "connected") {
    return (
      <div className="walletSlimRow">
        <button
          className="walletGhostBtn"
          type="button"
          disabled={status === "connecting"}
          onClick={handleConnect}
        >
          {status === "connecting" ? (
            <>
              <span className="spinner dark" aria-hidden="true" />
              <span>Connecting…</span>
            </>
          ) : (
            <>
              <span className="walletIcon" aria-hidden="true">◈</span>
              <span>Connect wallet</span>
              <span className="walletChipHint">Auto-scans your address</span>
            </>
          )}
        </button>
        {error && <span className="walletInlineError" role="alert">{error}</span>}
      </div>
    );
  }

  const onBase = isBaseChain(chainId);

  return (
    <div className="walletConnectedContainer">
      <div className="walletConnectedBar">
        <div className="walletIdentityGroup">
          <span className="walletConnectedDot" aria-hidden="true" />
          <strong className="walletProviderName">{name}</strong>
          <code className="walletAddressCode">{shortAddress(address)}</code>
          <button
            className="walletCopyIconBtn"
            type="button"
            onClick={handleCopy}
            aria-label="Copy connected wallet address"
          >
            {copied ? "✓" : "📋"}
          </button>
          <span className={`walletNetworkTag ${onBase ? "networkBase" : "networkWarn"}`}>
            {onBase ? "Base Mainnet" : describeChain(chainId)}
          </span>
        </div>

        <div className="walletActionBar">
          {!onBase && (
            <button
              type="button"
              className="walletGhostBtn actionBtnSmall"
              disabled={switching}
              onClick={handleSwitchToBase}
            >
              {switching ? "Switching…" : "Switch to Base"}
            </button>
          )}
          <button
            type="button"
            className="walletActionSendBtn"
            onClick={() => onOpenSendModal?.()}
          >
            🛡️ Protected Send
          </button>
          <button
            type="button"
            className="walletGhostBtn actionBtnSmall"
            disabled={scanning}
            onClick={() => onAddress(address)}
          >
            {scanning ? "Scanning…" : "Re-scan"}
          </button>
          <button
            className="walletDisconnectBtn"
            type="button"
            onClick={handleDisconnect}
            aria-label="Disconnect wallet"
          >
            Disconnect
          </button>
        </div>
      </div>
      {error && <p className="walletInlineError" role="alert">{error}</p>}
    </div>
  );
}
