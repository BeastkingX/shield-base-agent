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
    return <span>checking wallet…</span>;
  }

  if (status === "unsupported") {
    return (
      <span style={{ fontSize: "12.5px" }}>
        <button className="ghostbtn" type="button" onClick={handleConnect}>
          Connect wallet
        </button>{" "}
        <span>· read-only, never signs</span>
      </span>
    );
  }

  if (status !== "connected") {
    return (
      <>
        <button
          className="ghostbtn"
          type="button"
          disabled={status === "connecting"}
          onClick={handleConnect}
        >
          {status === "connecting" ? "Connecting…" : "Connect to auto-scan"}
        </button>
        <span>· read-only, never signs</span>
        {error && <span style={{ color: "var(--red)", fontSize: "12px", marginLeft: "8px" }}>{error}</span>}
      </>
    );
  }

  const onBase = isBaseChain(chainId);

  return (
    <div className="walletConnectedContainer" style={{ width: "100%", marginTop: "12px" }}>
      <div className="walletIdentityGroup">
        <span className="walletConnectedDot" aria-hidden="true" />
        <strong>{name}</strong>
        <code>{shortAddress(address)}</code>
        <button
          type="button"
          className="ghostbtn"
          style={{ minHeight: "28px", padding: "2px 8px", fontSize: "11px" }}
          onClick={handleCopy}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <span
          className="etag"
          style={{
            color: onBase ? "var(--green)" : "var(--amber)",
            borderColor: onBase ? "rgba(52,211,153,.3)" : "rgba(251,191,36,.3)",
          }}
        >
          {onBase ? "Base Mainnet" : describeChain(chainId)}
        </span>
      </div>

      <div className="walletActionBar">
        {!onBase && (
          <button
            type="button"
            className="ghostbtn"
            style={{ minHeight: "32px", padding: "4px 10px", fontSize: "12px" }}
            disabled={switching}
            onClick={handleSwitchToBase}
          >
            {switching ? "Switching…" : "Switch to Base"}
          </button>
        )}
        <button
          type="button"
          className="walletSendPill"
          onClick={() => onOpenSendModal?.()}
        >
          Protected Send →
        </button>
        <button
          type="button"
          className="ghostbtn"
          style={{ minHeight: "32px", padding: "4px 10px", fontSize: "12px" }}
          disabled={scanning}
          onClick={() => onAddress(address)}
        >
          {scanning ? "Scanning…" : "Re-scan"}
        </button>
        <button
          type="button"
          className="ghostbtn"
          style={{ minHeight: "32px", padding: "4px 10px", fontSize: "12px", color: "var(--red)" }}
          onClick={handleDisconnect}
        >
          Disconnect
        </button>
      </div>
      {error && <p style={{ color: "var(--red)", fontSize: "12px", margin: 0, width: "100%" }}>{error}</p>}
    </div>
  );
}
