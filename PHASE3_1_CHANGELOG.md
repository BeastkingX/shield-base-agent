# Shield Phase 3.1 Update

## Multi-Hop Money-Trail, Sweeper Bot Detection & Token Approvals Audit

- **Active ERC-20 Approvals Audit (`src/lib/approvals.ts`)**:
  - Automatically queries and parses ERC-20 `Approval` event logs on Base Mainnet.
  - Identifies unlimited allowances (`uint256.max` threshold) and classifies spenders into canonical DEX protocols (Uniswap Universal Router, Permit2, Aerodrome, LiFi Diamond) vs unverified contracts.
  - Resolves `EVIDENCE_ACTIVE_APPROVALS` into the deterministic evidence receipt.

- **2-Hop Focal Traversal & Money-Trail Taint (`src/lib/cluster-detector.ts`)**:
  - Traces 1-hop upstream to identify who provided seed gas for target account creation.
  - Detects shared gas dispensers associated with known phishing drainer clusters.
  - Emits `EVIDENCE_MONEY_TRAIL_CLUSTER`.

- **Compromised Wallet & Sweeper Bot Detector**:
  - Analyzes inter-block deposit-to-sweep velocity (<30 seconds).
  - Flags active sweeper bot activity when incoming funds are automatically drained, protecting users from sending gas to compromised wallets.
  - Fires `RULE_COMPROMISED_SWEEPER_DETECTED` with verdict `HIGH OBSERVED RISK` and warning: *"DO NOT SEND FUNDS: This recipient has an active SWEEPER BOT."*

- **UI & Presets Integration (`src/app/page.tsx`)**:
  - Preserved 100% of the Base Blue and White theme (`--blue: #1557ff`, radial glow, clean card layout).
  - Added one-click test presets:
    - *Try WETH on Base →* (OP Stack Predeploy)
    - *Try vitalik.eth (EIP-7702) →* (Delegated Account + 36 Approvals Audited)
    - *Try Sweeper Bot Trap →* (Active Sweeper Bot Alert)

- **Test Suite**:
  - All 47 Vitest unit tests passing across all 8 test suites.
