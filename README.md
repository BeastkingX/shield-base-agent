# Shield

Shield is an evidence-backed safety agent for Base. A user enters a Base wallet or smart-contract address. Shield reads live blockchain data, chooses appropriate checks, applies transparent rules, and produces a block-referenced evidence receipt.

> Shield helps users make decisions. It cannot guarantee that an address is safe.

# Complete beginner guide for Windows

You do not need to understand all the code before running the project. Follow these steps in order.

## What the tools mean

- **Node.js** lets your computer run this JavaScript/TypeScript application.
- **VS Code** is the program in which you view and edit the project files.
- **Terminal** is the text box inside VS Code where you give your computer commands.
- **npm** comes with Node.js. It downloads the packages the application needs.
- **localhost** means a website running privately on your own computer. It is not publicly accessible.
- **GitHub** stores a copy of the code online. We will connect it after the application runs locally.

## Step 1 — Install Node.js

1. Visit https://nodejs.org/
2. Download the version marked **LTS**.
3. Open the downloaded installer.
4. Keep the default options selected and finish the installation.
5. Close and reopen VS Code if it was already running.

Node.js is required for the `npm` commands below.

## Step 2 — Install VS Code

1. Visit https://code.visualstudio.com/
2. Download the Windows version.
3. Install it using the default options.
4. Open VS Code.

## Step 3 — Download and extract Shield

1. Download `shield-starter.zip` from the Arena workspace.
2. Find it in your Windows **Downloads** folder.
3. Right-click the ZIP file and choose **Extract All**.
4. Open the extracted `shield` folder.

Do not try to run the project while it is still inside the ZIP file.

## Step 4 — Open the Shield folder in VS Code

1. Open VS Code.
2. Select **File → Open Folder**.
3. Select the extracted `shield` folder.
4. If VS Code asks whether you trust the folder, select **Yes, I trust the authors**.

You should see files including `package.json`, `README.md`, and `PROJECT_SPEC.md` on the left side.

## Step 5 — Open the terminal

In VS Code, select:

**Terminal → New Terminal**

A terminal panel will open at the bottom of VS Code. Check that the line ends with the name `shield`. If it does not, the wrong folder may be open.

## Step 6 — Check that Node.js works

Type this command in the terminal and press Enter:

```powershell
node --version
```

You should see a version beginning with `v`, such as `v20` or a newer LTS version.

Then type:

```powershell
npm --version
```

You should see another version number.

If Windows says that `node` or `npm` is not recognized, restart the computer and try again. If it still fails, reinstall Node.js LTS.

## Step 7 — Download the project packages

Type this in the VS Code terminal and press Enter:

```powershell
npm install
```

What this does: it reads `package.json` and downloads Next.js, React, viem, and the other packages Shield needs. It can take a few minutes. A new folder named `node_modules` will appear; you do not need to open or edit it.

Warnings are not always errors. Wait until the command finishes and the terminal allows you to type again.

## Step 8 — Create the private settings file

Type this command and press Enter:

```powershell
Copy-Item .env.example .env.local
```

What this does: it copies the example settings into a private local settings file. Base’s public development RPC works without an account.

A complete Phase 2.4 scan uses two free, server-only explorer keys because the providers have different Base coverage.

### Add Etherscan for verified source metadata

1. Open https://etherscan.io/register and create or sign in to an Etherscan account.
2. Open https://etherscan.io/myapikey and create an API key.
3. Open `.env.local` in VS Code.
4. Put the key after `ETHERSCAN_API_KEY=` with no quotation marks.

Etherscan's source and ABI endpoints remain free on Base. Its general Base API data, including creation and normal transaction history, currently requires a paid Etherscan plan; Shield therefore does not rely on it for those checks.

### Add Blockscout for creation and activity

1. Open https://dev.blockscout.com/ and create or sign in to a Blockscout developer account.
2. Create a free PRO API key. The free tier does not require a credit card.
3. Put the key after `BLOCKSCOUT_API_KEY=` with no quotation marks.
4. Save `.env.local` and restart `npm.cmd run dev` if Shield was already running.

Your private file should contain both values:

```text
ETHERSCAN_API_KEY=your_private_etherscan_key_here
BLOCKSCOUT_API_KEY=your_private_blockscout_key_here
```

Shield sends Base chain ID `8453` to both universal APIs. It prefers Blockscout for creation and transaction history, can fall back to Etherscan when that key's plan supports Base, and records the provider used on each evidence item. For recent activity, Shield first uses Blockscout's Etherscan-compatible `account.txlist` route and automatically retries the same evidence through Blockscout's modern Base REST address-transactions route if the compatibility route fails. Missing or failed checks remain explicitly unavailable; Shield never pretends they passed.

Never put a wallet private key or recovery phrase in `.env.local`. Never commit `.env.local`, paste its contents into chat, or use a `NEXT_PUBLIC_` name for either API key.

If you use Command Prompt instead of PowerShell, use this command:

```cmd
copy .env.example .env.local
```

## Step 9 — Start Shield

Type this command and press Enter:

```powershell
npm run dev
```

Wait until the terminal shows something similar to:

```text
Local: http://localhost:3000
Ready
```

Leave the terminal open while using Shield.

## Step 10 — Open Shield in your browser

Open Chrome, Edge, or Firefox and visit:

http://localhost:3000

You should see the Shield homepage. Click **Use WETH contract example**, then click **Run Shield scan**.

The scan uses real Base mainnet data, but it does not make a transaction and does not cost money.

## How to stop the application

Return to the VS Code terminal and press:

```text
Ctrl + C
```

If Windows asks whether to terminate the batch job, type `Y` and press Enter.

## How to start it again later

1. Open the `shield` folder in VS Code.
2. Select **Terminal → New Terminal**.
3. Run:

```powershell
npm run dev
```

You only need to run `npm install` again if the project packages change or the `node_modules` folder is deleted.

## Common Windows problem: scripts are disabled

If PowerShell shows an error saying `npm.ps1 cannot be loaded because running scripts is disabled`, do not change Windows security settings. Use either of these safe options:

### Option A — Use npm.cmd

```powershell
npm.cmd install
npm.cmd run dev
```

### Option B — Switch the VS Code terminal to Command Prompt

1. In the terminal panel, click the small arrow beside the `+` button.
2. Select **Command Prompt**.
3. Run `npm install` and `npm run dev` again.

# Current features

Shield Phase 2.4 currently provides:

- Base mainnet RPC health and block-reference checks
- EVM address validation
- Wallet-versus-contract classification using `eth_getCode`
- Strict EIP-7702 delegation-designator detection, including delegate address and wallet execution semantics
- Native ETH balance and transaction-count reads
- Standard EIP-1967 proxy implementation-slot check for contracts, without treating an empty slot as proof that no proxy exists
- Verified source metadata from Etherscan V2, with explorer-reported proxy status surfaced as deterministic caution evidence
- Free Base creation and activity evidence from Blockscout's keyed PRO API
- Redundant Blockscout activity retrieval through compatibility and modern REST routes
- Exact-match official provenance for documented Base/OP Stack protocol predeploys such as WETH9
- Provider fallback for ordinary contract creator, creation transaction, block, timestamp, and age evidence
- The ten most recent indexed normal transactions with basic direction and failure summaries
- Versioned deterministic verdict logic with required evidence gates
- Evidence categories, structured facts, source methods, block numbers, and limitations
- Evidence filters plus copy and JSON receipt download controls
- Explicit unavailable states for missing keys, provider failures, and checks that have not run

Active approval discovery, internal-call history, token-transfer history, transaction simulation, AI evidence summaries, and community reports are later milestones. The interface does not fabricate those results.

# Environment variables

The `.env.local` file contains private settings used by the backend. Do not upload this file to GitHub and do not paste its values into browser code.

```text
BASE_RPC_URL=https://mainnet.base.org
ETHERSCAN_API_KEY=
BLOCKSCOUT_API_KEY=
AI_API_KEY=
AI_MODEL=
```

`ETHERSCAN_API_KEY` supplies verified-source metadata. `BLOCKSCOUT_API_KEY` supplies free Base contract-creation and normal-transaction history. The AI settings remain unused because model output is not allowed to control evidence or verdicts. Never place a wallet private key or recovery phrase in this project.

## Add the private keys to Vercel

After adding the keys locally, configure them separately for the public deployment:

1. Open the Shield project in the Vercel dashboard.
2. Choose **Settings → Environment Variables**.
3. Add `ETHERSCAN_API_KEY` and paste the private Etherscan value.
4. Add `BLOCKSCOUT_API_KEY` and paste the private Blockscout value.
5. Select the Production environment for both, save them, and redeploy the latest deployment.

Do not add `.env.local` to GitHub. Vercel reads its own encrypted environment variables at runtime.

# Architecture

```text
Address entered by user
          ↓
Input validation
          ↓
Shield orchestrator
          ↓
Live Base RPC tools
          ↓
Normalized evidence
          ↓
Deterministic risk engine
          ↓
Block-referenced scan receipt
          ↓
Human-readable interface
```

Read [`PROJECT_SPEC.md`](./PROJECT_SPEC.md) for the complete product scope and build order.

# Developer commands

- `npm run dev` — start Shield privately on your computer
- `npm run build` — check whether a production version can be created
- `npm run lint` — look for common code-quality problems
- `npm test` — run the automated risk-engine tests

# Safety principles

- Failed checks are marked unavailable, never converted into safe results.
- A language model cannot change balances, blockchain facts, or deterministic verdicts.
- Proxy status and lack of source verification are warnings, not proof of fraud.
- No private key is needed to scan an address.
