# 🛡️ Shield — Evidence-backed safety for Base

**Scan any Base wallet or contract → get a block-referenced safety receipt you can verify without trusting us.**

Live app: https://shield-base-agent.vercel.app/  
Chain: Base Mainnet (8453) · Engine: deterministic rules v0.3 + measured money-trail · AI layer: receipt-grounded copilot

---

## Why Shield

Security tools ask you to trust a black-box score. Shield does the opposite:
every claim in a scan receipt cites its evidence, its method, its block, and its limitations —
and every receipt carries a **SHA-256 content hash you can recompute yourself**.

**Verify any receipt yourself:**
1. Download the receipt JSON from the app.
2. Remove the `receiptId` and `receiptHash` fields.
3. `sha256` the remaining JSON (compact separators, UTF-8).
4. Compare with `receiptHash`. Match = the receipt is exactly what the engine produced.

## What a scan measures (all live, all sourced)

- **Chain state & target type** — live Base RPC; EIP-1967 proxy slots; **EIP-7702 delegation designators** (we parse the exact delegate — most scanners crash or misclassify these).
- **Exposure** — active ERC-20 approvals indexed on-chain; unlimited allowances escalate the verdict (sprawl is risk).
- **Measured money trail** — earliest sampled inbound funder (1-hop up), the funder's own funder (hop-2), dominant outflow hub (1-hop down), and **measured deposit-to-forward timing** in seconds. A median ≤30s over ≥2 samples = automated sweep behavior. Behavioral claims only — we never name threat groups we cannot attribute.
- **Third-party threat intel** — GoPlus address security flags, cited as an external source (never as our own evidence).
- **Honest failure** — if a data provider is unreachable, the receipt marks that check `unavailable` and coverage drops visibly. Missing evidence never silently counts as a pass.

## The AI copilot

A receipt-grounded assistant: ask it anything about Web3 safety, or attach a scan and interrogate the evidence.
It answers from the receipt — challenge it with a false premise and it will correct you.
Showcase knowledge cards (Ostium $23.75M signer-key exploit; mempool sweeper mechanics) are seeded from verified facts.

## Tests

`npm test` — 53 passing (Vitest: risk engine, cluster detector with measured-sweep fixtures, 7702 parsing, clients, wallet logic).

## Verdict log

`verdicts/` — hourly automated re-scans of the Shield watchlist, committed by CI.
If the log goes quiet, our external monitor pages us — a silent log is reported as an incident, not hidden.

## Run locally

```bash
npm install
cp .env.example .env.local   # Blockscout key recommended (free: dev.blockscout.com), Etherscan key optional
npm run dev
```

## Roadmap

- x402 pay-per-call endpoint ($0.01/verifiable-scan, USDC on Base)
- On-chain anchoring of receipt hashes (Base attestations)
- Multi-hop depth beyond 2 hops; token-flow-aware sweep measurement

## Honest limitations

- Decision support, not a guarantee. A brand-new threat with zero on-chain history cannot be caught by flow analysis.
- Rate limiting is per-instance (serverless best-effort).
- Threat-intel lists can lag fresh attackers and may carry stale entries.

*Shield helps you decide. It never decides for you.*
