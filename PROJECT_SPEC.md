# SHIELD — Evidence-Backed Safety Agent for Base

## 1. Product promise

**Before interacting with an address or contract on Base, run a Shield scan. Shield gathers live on-chain facts, chooses checks appropriate to the target, applies transparent safety rules, and produces a block-referenced evidence receipt.**

Shield is a decision-support tool, not a guarantee that an address is safe.

## 2. The user problem

Ordinary users often see a hexadecimal wallet or contract address immediately before sending funds, approving a token, or interacting with an application. Raw explorer pages contain useful data, but they do not turn it into a concise, evidence-backed safety briefing.

Shield provides that briefing without allowing a language model to invent balances, transactions, scores, or verdicts.

## 3. Honest MVP scope

A user pastes a Base address. Shield will:

1. Validate the address and confirm Base mainnet.
2. Record the current block number used for the scan.
3. Use live RPC data to classify the address as an externally owned account (wallet) or smart contract.
4. Select a relevant scan path for that classification.
5. Run deterministic checks.
6. Calculate an observed-risk rating from explicit rules.
7. Generate an evidence receipt containing raw values, check IDs, timestamps, block references, and explorer links.
8. Present a concise safety briefing in an accessible interface.

### Initial wallet checks

- Native ETH balance
- Transaction count/nonce
- Whether contract bytecode exists
- Recent activity when an indexed-data provider is configured
- Active ERC-20 approvals when an indexed-data provider is configured

### Initial contract checks

- Bytecode existence and size
- Contract verification status when the explorer API is configured
- Proxy indicators, including standard EIP-1967 storage slots
- Contract creation information when the explorer API is configured
- Recent activity when the explorer API is configured

## 4. Verdict language

Shield must not label a target simply “Safe.” A limited scan cannot prove safety.

The allowed verdicts are:

- **LOW OBSERVED RISK** — no serious signal was found by the checks that completed.
- **CAUTION** — one or more meaningful warning signals were found.
- **HIGH OBSERVED RISK** — strong evidence-backed risk signals were found.
- **INSUFFICIENT DATA** — too few checks completed to make a useful assessment.

Every verdict must show scan coverage and limitations.

## 5. Agent behavior

Shield is more than a single prompt. Its orchestrator follows an evidence-first workflow:

1. **Observe:** validate input and capture chain state.
2. **Classify:** determine whether the target is a wallet or contract.
3. **Plan:** select tools and checks for that target type.
4. **Execute:** call Base RPC and configured indexed-data services.
5. **Verify:** normalize results and reject malformed or unsupported claims.
6. **Score:** apply deterministic rules; the model cannot change the score.
7. **Explain:** a language model may summarize only the structured evidence and must cite evidence IDs.
8. **Receipt:** return a reproducible scan record.

A deterministic explanation is used if no model provider is configured, so the core scanner still works.

## 6. Evidence contract

Each finding contains:

```json
{
  "id": "EVIDENCE_CODE_PRESENT",
  "label": "Contract bytecode detected",
  "status": "pass | warning | danger | info | unavailable",
  "claim": "This address contained deployed bytecode at the scanned block.",
  "source": "base-rpc",
  "method": "eth_getCode",
  "blockNumber": 12345678,
  "observedAt": "ISO-8601 timestamp",
  "rawValue": "0x...",
  "explorerUrl": "https://basescan.org/address/0x...",
  "limitations": []
}
```

Numbers shown in the interface must come from this evidence layer, never directly from model output.

## 7. Risk engine rules

The first version will use versioned, inspectable rules. Example signals include:

- Invalid or unsupported input → insufficient data
- Explorer/RPC failure → unavailable check, never silently treated as safe
- Unverified contract → caution, not automatic danger
- Standard proxy detected → disclosure/caution, not automatic danger
- Newly created contract plus low activity → caution
- Active unlimited approval to a high-risk spender → high observed risk when supporting evidence exists
- Evidence-linked community reports → displayed separately until their claims are reviewed

The output includes the risk-engine version and the exact rules that fired.

## 8. Community evidence — second milestone

A community report will require:

- Base address being reported
- Category and human-readable claim
- Base transaction hash or other on-chain reference
- Optional supporting URL
- Reporter wallet signature

“Evidence linked” will mean only that the transaction exists and is connected to the reported address. It will not mean the accusation itself has been proven. Reports will have clear states: pending, evidence-linked, reviewed, rejected.

This milestone requires persistent storage and anti-spam controls. It will not block the core scanner launch.

## 9. Technical architecture

- **Application:** Next.js with TypeScript
- **UI:** custom responsive CSS using Base-inspired blue and white; accessibility before animation
- **Validation:** Zod
- **On-chain reads:** viem
- **Primary chain:** Base mainnet, chain ID 8453
- **Core source:** Base JSON-RPC
- **Indexed metadata:** Etherscan V2 API for Base when configured
- **AI explanation:** provider added behind a server-only adapter; no API keys in browser code
- **Database for community reports:** Supabase/PostgreSQL in milestone two
- **Deployment:** Vercel
- **Source control:** GitHub

## 10. API boundaries

- `POST /api/scan` — validates an address, runs the orchestrator, and returns a receipt
- `GET /api/health` — confirms application and Base RPC availability
- `POST /api/reports` — milestone two; validates and stores a signed report
- `GET /api/reports?address=...` — milestone two; returns report states for a target

## 11. What we will not claim before it exists

- Guaranteed safety or guaranteed scam detection
- Pre-sign transaction protection
- Transaction simulation
- Wallet clustering
- Live liquidity-reserve analysis
- Fully verified community accusations
- Reputation scores backed only by placeholder data
- Twenty pilot reports before twenty real reports have been collected
- A “100-point” judging score

## 12. Differentiation

We will not attack competing entries or make exclusivity claims that cannot be proven. Shield’s defensible position is:

**A user-facing, pre-interaction safety briefing that combines target-aware Base scans with reproducible evidence receipts and, later, evidence-linked community reports.**

## 13. Build order

### Milestone 1 — Real scanner

- Project scaffold
- Address input and validation
- Live Base RPC health check
- Wallet/contract classification
- Block-referenced evidence receipt
- Deterministic risk engine
- Tests with known Base addresses

### Milestone 2 — Deeper evidence

- Explorer API integration
- Contract verification and creation metadata
- Approval exposure checks
- AI evidence summarizer with citation enforcement

### Milestone 3 — Product experience

- Polished scan workflow
- Evidence timeline and expandable raw facts
- Responsive blue/white interface
- Shareable receipt URL or export
- Clear loading, error, and unavailable states

### Milestone 4 — Community and submission

- Evidence-linked reports
- Wallet signatures and anti-spam controls
- Public deployment
- README, architecture diagram, demo video, testing notes
- Pilot scans and real feedback

## 14. First success criterion

The first meaningful demo is not an animation. It is this:

> Paste a real Base address → Shield calls Base → correctly identifies wallet or contract → shows the block used → produces an honest verdict with inspectable evidence → handles a failed data source without pretending the target is safe.
