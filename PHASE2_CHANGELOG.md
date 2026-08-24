# Shield Phase 2.3 update

## Activity-route resilience

- Kept Blockscout's keyed Etherscan-compatible `account.txlist` route as the first source for recent normal transactions.
- Added Blockscout's keyed Base REST route, `/8453/api/v2/addresses/{address}/transactions`, as an independent fallback when the compatibility route times out, returns HTTP 500, rejects the request, or returns malformed data.
- Normalizes REST `items` into Shield's existing `IndexedTransaction` shape before deterministic evidence rules run.
- Preserves conservative behavior: an empty, valid REST `items` list is completed evidence, while failure of both Blockscout routes remains unavailable evidence rather than a safe result.
- Keeps the API key server-only and sends it to both Blockscout routes without exposing it in receipts or browser code.
- Updated activity evidence method text so receipts disclose the compatibility-to-REST fallback.

## Existing evidence behavior retained

- Etherscan V2 remains the server-only source for free verified-source metadata on Base Mainnet (`chainid=8453`).
- Blockscout remains the preferred provider for free Base creation and activity evidence; Etherscan remains the outer provider fallback when its configured plan supports Base indexed endpoints.
- The completed evidence item records the provider actually used (`blockscout-pro` or `etherscan-v2`).
- Exact-address official provenance remains enabled for Base WETH9, an OP Stack protocol predeploy with no ordinary user-submitted creation transaction.
- Shield never infers official identity from an address prefix and never fabricates a creator, creation hash, or creation block.
- Deterministic risk rules still require verification, provenance, and activity evidence before a contract can receive `LOW OBSERVED RISK`.

## Scan experience

- Advanced the displayed application version to `v0.2.3`.
- Documented the two Blockscout activity routes and their fallback order in the beginner guide, project specification, and environment example.
- Existing receipt overview, evidence filters, structured facts, source links, JSON download, and responsive layouts are unchanged.

## Verification

Completed successfully on August 24, 2026:

- `npm test` — 23 tests passed across six test files.
- Blockscout tests cover compatibility-route success, REST recovery after compatibility HTTP 500, REST normalization, empty REST history, malformed responses, both-route failure, missing-key behavior, and creation lookup.
- `npm run lint` — completed with no errors.
- `npx tsc --noEmit` — strict TypeScript validation completed with no errors.
- `npm run build` — production compilation, TypeScript checks, static generation, and route generation completed successfully.

## User validation

Completed locally on August 24, 2026 with receipt `shield_c40e2a7057891405594f`:

- Scanned official Base WETH9 at block `50371412`.
- All 8 of 8 evidence checks completed with no unavailable evidence.
- The deterministic verdict was `LOW OBSERVED RISK`, with the receipt retaining the explicit non-guarantee limitation.
- Exact official-predeploy provenance completed without inventing an ordinary creator, creation transaction, or creation block.
- Blockscout returned ten recent normal transactions through `account.txlist`, so the REST fallback did not need to activate during this specific live scan.
- Automated coverage separately verifies HTTP 500 recovery through REST and conservative unavailable behavior when both Blockscout routes fail.

## Still intentionally not implemented

- ERC-20 approval exposure
- Internal calls and token-transfer history
- Transaction simulation
- AI evidence summarization
- Evidence-backed community reports
- Persisted shareable receipt URLs
