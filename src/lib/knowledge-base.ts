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
      "Root cause: a compromised ORACLE SIGNER private key, not a smart contract code bug or governance flaw.",
      "The attacker held an authorized signer credential. They used the registered PriceUpKeep forwarder to submit fake BTC-USD price reports.",
      "With trusted price reports, the attacker opened a position at $5,000 and closed it near $60,000 in one transaction loop, draining profits from the public OLP liquidity vault.",
      "Trader collateral in separate contracts was untouched. The liquidity provider vault absorbed all losses.",
      "The attack ran across 8 transaction cycles, preceded by a small 100 USDC test probe.",
      "Lesson: Off-chain key management is critical infrastructure. Solidity audits do not cover off-chain operational keys.",
    ],
  },
  {
    id: "sweeper-bots",
    topic: "Sweeper Bots (Compromised Private Keys)",
    keywords: ["sweeper", "compromised key", "drain gas", "evaporate", "rescue gas"],
    facts: [
      "A sweeper bot is an automated script. It watches the public mempool for any incoming funds to a leaked private key.",
      "The moment gas or tokens arrive, the bot broadcasts an outgoing transfer in the next block (<8 seconds), stealing the funds before the user can act.",
      "To a victim trying to rescue assets by sending gas, the incoming deposit appears to evaporate within seconds.",
      "Defense: Never share private keys or seed phrases. Treat any address that forwards deposits instantly as permanently compromised.",
      "Shield detects sweeper bots by measuring deposit-to-forward time deltas across indexed history.",
    ],
  },
  {
    id: "eip-7702",
    topic: "EIP-7702 Account Abstraction on Base",
    keywords: ["7702", "eip-7702", "delegation", "delegated", "account abstraction"],
    facts: [
      "EIP-7702 lets a standard wallet borrow code from another smart contract without deploying a separate proxy.",
      "The wallet stores a 23-byte tag (0xef0100 + 20-byte delegate address) in its account code field.",
      "The wallet keeps normal private key transaction signing. When called, it runs the delegate contract's code in its own storage context.",
      "This enables 1-click batched transactions (like Approve + Swap in one click), session keys, and sponsored gas.",
      "Shield checks the delegate contract code and provenance to verify whether the helper contract is verified or suspicious.",
    ],
  },
  {
    id: "eip7702-delegation-drain",
    topic: "EIP-7702 Delegation Phishing & Drain Attacks",
    keywords: ["7702 drain", "7702 scam", "7702 attack", "delegation drain", "delegate scam", "malicious delegate"],
    facts: [
      "An EIP-7702 delegation makes a wallet point at a delegate contract. Every subsequent transfer runs the delegate's logic.",
      "Attack pattern (Base, 2026): phishing sites trick users into signing a 7702 authorization pointing to an unverified contract. The wallet looks clean while deposits leave in seconds.",
      "A mass-deployer creator account with thousands of sent transactions interacting with victim wallets is the measurable fingerprint.",
      "Defense: before sending to any 7702-delegated wallet, evaluate the delegate contract. Shield does this in EVIDENCE_7702_DELEGATE.",
    ],
  },
  {
    id: "approvals-exposure",
    topic: "Unlimited Token Approvals & Allowance Hygiene",
    keywords: ["approval", "allowance", "unlimited", "permit2", "revoke"],
    facts: [
      "Token approvals grant smart contracts permission to transfer tokens from a user's wallet up to a set allowance.",
      "Most DeFi apps request unlimited allowances (type(uint256).max = 1.15e77) to save users gas on future trades.",
      "If an approved contract has a bug or gets upgraded maliciously, an attacker can move all approved tokens without user interaction.",
      "Shield audits Approval events on Base Mainnet, flags unlimited permissions, and checks spender protocol reputation.",
      "Remediation: Regularly review allowances and revoke unneeded permissions using tools like revoke.cash or direct contract calls.",
    ],
  },
  {
    id: "reading-a-shield-receipt",
    topic: "How to Read and Cryptographically Verify a Shield Scan Receipt",
    keywords: ["read receipt", "verify receipt", "receipthash", "coverage", "receipt format"],
    facts: [
      "Every receipt lists evidence with status pass, info, warning, danger, or unavailable.",
      "'unavailable' means the check could not run due to missing data or provider downtime. It never counts as a pass.",
      "receiptHash is a SHA-256 digest over the receipt content. Recompute it to verify the receipt was not modified.",
      "Coverage (for example, 7/7 or 9/9) tells you how much of the required security surface was actually checked. Check it before trusting a LOW OBSERVED RISK verdict.",
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
