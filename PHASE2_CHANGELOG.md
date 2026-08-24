# Shield Phase 2.4 update

## EIP-7702 delegated-wallet classification

- Added a strict parser for the EIP-7702 delegation designator: exactly 23 bytes containing `0xef0100` followed by a 20-byte delegate address.
- Ordinary bytecode, truncated indicators, and longer prefix-matching bytecode remain classified as contract code.
- An account carrying the exact designator is classified as a delegated wallet under Shield's current `wallet | contract` receipt model, not as an ordinary deployed contract.
- Target evidence now discloses the delegate address, the 23-byte designator length, execution in the authority wallet's account context, and the fact that the delegated wallet may still originate transactions.
- Delegated-wallet receipts use wallet-relevant activity and approval evidence. They no longer run source-verification, creation-provenance, or EIP-1967 storage checks against the authority address.
- Limitations explicitly state that Shield identifies the delegation but does not yet analyze the delegate contract's behavior.

## Honest proxy evidence

- Renamed the negative storage result to **No EIP-1967 implementation found**.
- The evidence claim now states that an empty EIP-1967 slot does not rule out other proxy patterns.
- When Etherscan/BaseScan source metadata reports `Proxy=1`, Shield shows **Published source verified; proxy reported**, records the reported implementation, and marks the completed evidence as a warning.
- The deterministic risk engine therefore returns `CAUTION` for an explorer-reported proxy even when the EIP-1967 slot is empty. This is a review signal, not an allegation that a proxy is malicious.
- Advanced the receipt risk-engine version to `0.3` so this changed deterministic signal is auditable.

## Existing evidence behavior retained

- Etherscan V2 remains the server-only source for free verified-source metadata on Base Mainnet (`chainid=8453`).
- Blockscout remains the preferred provider for free Base creation and activity evidence, with compatibility-to-REST fallback for recent normal transactions.
- Exact-address official provenance remains enabled for Base WETH9.
- Failed or missing checks remain unavailable rather than being converted into safe results.
- Verdicts remain limited to `LOW OBSERVED RISK`, `CAUTION`, `HIGH OBSERVED RISK`, and `INSUFFICIENT DATA`.

## Scan experience

- Advanced the displayed application version to `v0.2.4`.
- Kept the evidence-first receipt UI, filters, structured facts, source links, copy controls, and JSON download.

## Verification

Completed successfully on August 24, 2026:

- `npm test` — 27 tests passed across seven test files.
- New tests cover exact EIP-7702 parsing, rejection of truncated and extended prefix matches, delegated-wallet orchestration, and explorer-reported proxy risk handling without an EIP-1967 slot value.
- `npm run lint` — completed with no errors.
- `npx tsc --noEmit` — strict TypeScript validation completed with no errors.
- `npm run build` — production compilation, TypeScript checks, static generation, and route generation completed successfully.

## Still intentionally not implemented

- Delegate-contract behavior analysis for EIP-7702 wallets
- ERC-20 approval exposure
- Internal calls and token-transfer history
- Transaction simulation
- AI evidence summarization
- Evidence-backed community reports
- Persisted shareable receipt URLs
