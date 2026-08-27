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
import ProtectedSendModal from "./ProtectedSendModal";

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

    // Detection runs on the next tick so the server-rendered markup and the
    // first client render agree (both say "checking"), avoiding hydration
    // mismatches while keeping state updates out of the effect body.
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
      <div className="walletPanel">
        <p className="walletNote" role="status">
          Checking for a wallet extension…
        </p>
      </div>
    );
  }

  if (status === "unsupported") {
    return (
      <div className="walletPanel">
        <p className="walletNote" role="status">
          <strong>No wallet extension detected.</strong> Install{" "}
          <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">MetaMask</a>,{" "}
          <a href="https://rabby.io/" target="_blank" rel="noreferrer">Rabby</a>, or{" "}
          <a href="https://www.coinbase.com/wallet" target="_blank" rel="noreferrer">Coinbase Wallet</a>{" "}
          to scan your own wallet automatically — or keep using the address box above.
        </p>
      </div>
    );
  }

  if (status !== "connected") {
    return (
      <div className="walletPanel">
        <div className="walletDivider"><span>Or connect your wallet</span></div>
        <button
          className="walletConnectBtn"
          type="button"
          disabled={status === "connecting"}
          onClick={handleConnect}
        >
          {status === "connecting" ? (
            <>
              <span className="spinner dark" aria-hidden="true" />
              Waiting for your wallet…
            </>
          ) : (
            <>
              <span className="walletIcon" aria-hidden="true">◈</span>
              Connect wallet
              <span className="walletBtnTag">Shield scans it instantly</span>
            </>
          )}
        </button>
        {error && <p className="walletError" role="alert">{error}</p>}
        <p className="walletNote">
          Read-only by default — Protected Send option available after connect.
        </p>
      </div>
    );
  }

  const onBase = isBaseChain(chainId);

  return (
    <div className="walletPanel">
      <div className="walletCard">
        <div className="walletInfo">
          <span className="walletIcon" aria-hidden="true">◈</span>
          <div className="walletMeta">
            <strong>{name} connected</strong>
            <span className="walletAddr">
              {shortAddress(address)}
              <button className="walletCopyBtn" type="button" onClick={handleCopy}>
                {copied ? "Copied" : "Copy"}
              </button>
            </span>
          </div>
          <span className={`networkBadge ${onBase ? "" : "off"}`}>
            {onBase ? "Base Mainnet" : describeChain(chainId)}
          </span>
        </div>
        <div className="walletActions">
          {!onBase && (
            <button type="button" disabled={switching} onClick={handleSwitchToBase}>
              {switching ? "Switching…" : "Switch to Base"}
            </button>
          )}
          <button
            className="primaryAction"
            type="button"
            onClick={() => onOpenSendModal?.()}
          >
            🛡️ Protected Send
          </button>
          <button
            type="button"
            disabled={scanning}
            onClick={() => onAddress(address)}
          >
            {scanning ? "Scanning…" : "Re-scan wallet"}
          </button>
          <button className="subtleAction" type="button" onClick={handleDisconnect}>
            Disconnect
          </button>
        </div>
      </div>
      {error && <p className="walletError" role="alert">{error}</p>}
      <p className="walletNote" role="status">
        Connected to Base Mainnet. Use <strong>Protected Send</strong> to verify any recipient address before broadcasting.
      </p>
    </div>
  );
}
