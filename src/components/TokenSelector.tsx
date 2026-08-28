"use client";

import { useState, useRef, useEffect } from "react";
import { isAddress } from "viem";
import Icon from "./Icon";

export interface TokenItem {
  symbol: string;
  name: string;
  address: string | null;
  decimals: number;
  badgeColor?: string;
}

export const SUPPORTED_BASE_TOKENS: TokenItem[] = [
  { symbol: "ETH", name: "Native Ether", address: null, decimals: 18, badgeColor: "#0052ff" },
  { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, badgeColor: "#2775ca" },
  { symbol: "WETH", name: "Wrapped Ether", address: "0x4200000000000000000000000000000000000006", decimals: 18, badgeColor: "#8b5cf6" },
  { symbol: "DEGEN", name: "Degen Token", address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed", decimals: 18, badgeColor: "#a855f7" },
  { symbol: "cbETH", name: "Coinbase Staked ETH", address: "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22", decimals: 18, badgeColor: "#0052ff" },
  { symbol: "DAI", name: "Dai Stablecoin", address: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", decimals: 18, badgeColor: "#f59e0b" },
  { symbol: "AERO", name: "Aerodrome Finance", address: "0x940181a94a35a4569e4529a3cdfb74e38fd98631", decimals: 18, badgeColor: "#0284c7" },
  { symbol: "BRETT", name: "Brett on Base", address: "0x532f27101965dd16442e59d40670faf5ebb142e4", decimals: 18, badgeColor: "#10b981" },
  { symbol: "TOSHI", name: "Toshi Base", address: "0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4", decimals: 18, badgeColor: "#6366f1" },
  { symbol: "VIRTUAL", name: "Virtuals Protocol", address: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b", decimals: 18, badgeColor: "#ec4899" },
];

interface TokenSelectorProps {
  selectedToken: TokenItem;
  onSelectToken: (token: TokenItem, customAddress?: string) => void;
  customAddress?: string;
  onCustomAddressChange?: (addr: string) => void;
}

export default function TokenSelector({
  selectedToken,
  onSelectToken,
  customAddress = "",
  onCustomAddressChange,
}: TokenSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = SUPPORTED_BASE_TOKENS.filter(
    (t) =>
      t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.address && t.address.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  const isCustomInput = isAddress(searchQuery.trim());

  const handlePick = (token: TokenItem) => {
    onSelectToken(token);
    setIsOpen(false);
    setSearchQuery("");
  };

  const handlePickCustom = () => {
    if (isCustomInput && onCustomAddressChange) {
      onCustomAddressChange(searchQuery.trim());
      onSelectToken(
        {
          symbol: "CUSTOM",
          name: "Custom ERC-20 Token",
          address: searchQuery.trim(),
          decimals: 18,
          badgeColor: "var(--blue-hi)",
        },
        searchQuery.trim(),
      );
      setIsOpen(false);
      setSearchQuery("");
    }
  };

  return (
    <div className="tokenSelectorContainer" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        className="tokenTriggerBtn"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <span
          className="tokenDotBadge"
          style={{
            backgroundColor: selectedToken.badgeColor || "var(--blue)",
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            display: "inline-block",
          }}
        />
        <span className="tokenSymbol" style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>
          {selectedToken.symbol}
        </span>
        <span className="tokenChevron">⌄</span>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="tokenDropdownMenu">
          <div className="dropdownSearchRow">
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search token or paste 0x address..."
            />
          </div>

          <div className="tokenItemsList">
            {isCustomInput && (
              <div className="customTokenAction" onClick={handlePickCustom}>
                <Icon name="coins" size={16} />
                <div className="tokenDetails">
                  <strong>Use Custom Contract</strong>
                  <small>{searchQuery.slice(0, 10)}...{searchQuery.slice(-6)}</small>
                </div>
                <span className="selectTag">Select ↗</span>
              </div>
            )}

            {filtered.map((token) => (
              <div
                key={token.symbol}
                className={`tokenOptionItem ${selectedToken.symbol === token.symbol ? "selected" : ""}`}
                onClick={() => handlePick(token)}
              >
                <span
                  style={{
                    backgroundColor: token.badgeColor || "var(--blue)",
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    display: "inline-block",
                  }}
                />
                <div className="tokenDetails">
                  <div className="symbolRow">
                    <strong style={{ fontFamily: "var(--font-mono)" }}>{token.symbol}</strong>
                    <span className="name">{token.name}</span>
                  </div>
                  {token.address && (
                    <small className="contractAddr">
                      {token.address.slice(0, 6)}...{token.address.slice(-4)}
                    </small>
                  )}
                </div>
                {selectedToken.symbol === token.symbol && <Icon name="check" size={14} style={{ color: "var(--blue)" }} />}
              </div>
            ))}

            {filtered.length === 0 && !isCustomInput && (
              <div className="emptyTokens">
                <p>No token found. Paste a valid Base contract address (0x...) to send any ERC-20 token.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
