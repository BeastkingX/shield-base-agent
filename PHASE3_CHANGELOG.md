# Shield Phase 3.0 update

## Connect wallet and scan before you act

- Added a **Connect wallet** panel to the scan page. It discovers any
  EIP-1193 wallet extension in the browser (MetaMask, Rabby, Coinbase
  Wallet, Frame, OKX Wallet, Trust Wallet, and similar) without adding
  any dependency or requiring a third-party project ID.
- On connect, Shield reads the account address and **scans it
  immediately**, showing the same evidence-backed verdict card and
  inspectable evidence trail produced for pasted addresses.
- The connected wallet gets its own status row: wallet name, shortened
  address with copy button, network badge, and a **Re-scan wallet** action.
- If the wallet is on another network, a network badge turns amber and a
  **Switch to Base** button offers `wallet_switchEthereumChain`, adding
  Base Mainnet first when the wallet does not know it (error 4902).
- Account and network changes made inside the wallet extension are
  followed live: switching the active account re-scans automatically.
- Connect is optional and strictly read-only. Shield never requests a
  signature and never sends a transaction; the manual address box and the
  per-address scan flow work exactly as before without a wallet.

## Implementation notes

- New `src/lib/wallet.ts` provides a small, fully typed EIP-1193 layer:
  provider detection (including multi-provider `window.ethereum.providers`
  unwrapping), `eth_requestAccounts`, `eth_chainId`, chain switching, and
  address helpers. All browser access is inside functions, so the module
  stays safe for server rendering.
- New `src/components/WalletPanel.tsx` owns connection state and listens
  to `accountsChanged` / `chainChanged`.
- The page now shares one `runScan` path between the address form and the
  wallet panel, so receipt structure and evidence collection are
  identical for both entry points.
- New `src/lib/wallet.test.ts` covers address formatting, provider
  picking, chain helpers, connection (including rejected requests), and
  Base chain switching.
- No new runtime dependencies. `viem`, `zod`, and the Next.js stack are
  unchanged.

## Release identity

- Application and package version advanced to `v0.3.0`.
- Risk-engine version remains `0.3`; verdict rules and evidence
  collection are unchanged from Phase 2.5. Wallet connection changes only
  how a scan can be started, never how a verdict is computed.

## What connecting does not do

- It does not request `personal_sign`, `eth_signTypedData`, or any other
  signature.
- It does not construct, sign, or broadcast transactions.
- It does not import or store keys, nor send address data anywhere
  besides Shield's own `/api/scan` endpoint and the public Base explorers
  linked from the evidence cards.
