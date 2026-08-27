export interface FactCard {
  id: string;
  topic: string;
  keywords: string[];
  facts: string[];
}

export const VERIFIED_FACT_CARDS: FactCard[] = [
  {
    id: "ostium-exploit",
    topic: "Ostium Exploit ($23.75M Vault Drain)",
    keywords: ["ostium", "oracle", "forwarder", "priceupkeep", "$23.75", "23.75"],
    facts: [
      "Ostium (Arbitrum perp DEX) lost $23.75M USDC on 2026-07-15.",
      "Root cause: a compromised ORACLE SIGNER private key — not a smart-contract code bug or governance flaw.",
      "The attacker held an authorized signer credential and used the legitimately registered PriceUpKeep forwarder to submit fabricated BTC-USD price reports.",
      "With trusted-but-false price data, the attacker opened a position at an artificial price ($5,000) and closed it near $60,000 inside the same transaction loop, draining profits directly from the public OLP liquidity provider vault.",
      "Trader collateral in separate trading contracts was untouched; the liquidity provider (OLP) vault absorbed 100% of the loss.",
      "The attack executed across 8 transaction cycles, preceded by a small 100 USDC test probe.",
      "Lesson: Key management and signer hygiene are critical protocol infrastructure. Solidity audits do not cover off-chain operational keys.",
    ],
  },
  {
    id: "sweeper-bots",
    topic: "Sweeper Bots (Compromised Private Keys)",
    keywords: ["sweeper", "compromised key", "drain gas", "evaporate", "rescue gas"],
    facts: [
      "A sweeper bot is an automated script monitoring the public mempool 24/7 for incoming value to an address whose private key has been leaked (e.g., via phishing, malware, or exposed seed phrase).",
      "The moment gas or tokens arrive, the bot broadcasts an outgoing transfer with higher gas priority in the same or next block (<8 seconds), stealing the funds before the victim can act.",
      "To a victim attempting to rescue remaining assets by sending gas, the incoming deposit appears to 'evaporate' within seconds.",
      "Defense: Never share private keys or seed phrases. Treat any address that forwards deposits instantly as permanently compromised.",
      "Shield detects sweeper bots directly by measuring inter-block deposit-to-forward delta velocity over indexed history.",
    ],
  },
  {
    id: "eip-7702",
    topic: "EIP-7702 Account Abstraction on Base",
    keywords: ["7702", "eip-7702", "delegation", "delegated", "account abstraction"],
    facts: [
      "EIP-7702 introduces native account abstraction for standard EOA wallets via a single opcode authorization.",
      "An EOA stores a 23-byte delegation designator (0xef0100 + 20-byte delegate address) in its account code field.",
      "The wallet retains standard ECDSA private key transaction origination authority, but when called, it executes the delegate contract's code in the wallet's own account storage context.",
      "Unlocks gas sponsorship (ERC-4337 Paymasters), session keys, and 1-click batched operations (e.g. Approve + Swap in 1 transaction) without migrating to a new smart account address.",
      "Shield is the first scanner on Base that specifically identifies EIP-7702 delegation designators and verifies delegate reputation rather than misclassifying the wallet as a smart contract.",
    ],
  },
  {
    id: "approvals-exposure",
    topic: "Unlimited Token Approvals & Allowance Hygiene",
    keywords: ["approval", "allowance", "unlimited", "permit2", "revoke"],
    facts: [
      "Token approvals grant smart contracts permission to transfer tokens from a user's wallet up to a specified allowance.",
      "Most DeFi dApps request unlimited allowances (type(uint256).max = 1.15e77) to save users gas on future trades.",
      "If an approved contract is vulnerable or upgraded maliciously, an attacker can sweep all approved tokens without user interaction.",
      "Shield audits indexed Approval(address,address,uint256) events on Base Mainnet, flags unlimited permissions, and verifies spender protocol authenticity.",
      "Remediation: Regularly audit allowances and revoke unneeded permissions using tools like revoke.cash or direct approve(spender, 0) calls.",
    ],
  },
];

export function findMatchingFactCard(query: string): FactCard | null {
  const clean = query.toLowerCase();
  for (const card of VERIFIED_FACT_CARDS) {
    if (card.keywords.some((kw) => clean.includes(kw))) {
      return card;
    }
  }
  return null;
}
