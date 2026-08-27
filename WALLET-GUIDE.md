# 🧬 Conway Automaton — Wallet Setup Guide

## Your Wallet

```
Address:   0x87716cE61c5Ff42e441B180Aa475fAD48Ca832ed
Private:   0x3292d645ac3758a0629552230bc2896dd6fa6c14584104ee38761a988d278020
Network:   Base (L2)
```

## 🔐 Important Security Notes

1. **Private Key = Full Control** — Anyone with your private key can spend all funds
2. **Never share publicly** — Only share with people you trust
3. **This is a TEST wallet** — Don't put large amounts in it
4. **Backup your key** — Write it down somewhere safe

## 💰 How to Fund Your Wallet

### Option 1: Coinbase / Base App (Easiest)
1. Open Coinbase app or Base App
2. Tap "Send" or "Transfer"
3. Paste your address: `0x87716cE61c5Ff42e441B180Aa475fAD48Ca832ed`
4. Select **Base** network (NOT Ethereum mainnet!)
5. Choose USDC
6. Send $5-10 to start
7. Wait 1-2 minutes for confirmation

### Option 2: MetaMask
1. Open MetaMask
2. Switch to Base network (chain ID 8453)
3. Click "Send"
4. Paste your address
5. Select USDC
6. Send $5-10

### Option 3: Bridge from Ethereum
1. Go to https://bridge.base.org
2. Connect your wallet
3. Bridge USDC from Ethereum → Base
4. Send to your address

## 🚀 Getting Started

### Step 1: Configure API Keys

Edit `~/.automaton/automaton.json` and add your API keys:

```json
{
  "conwayApiKey": "your-conway-api-key",
  "openaiApiKey": "sk-your-openai-api-key"
}
```

**To get Conway API key:**
1. Visit https://conway.tech
2. Sign up for an account
3. Get your API key from settings

**To get OpenAI API key:**
1. Visit https://platform.openai.com
2. Sign up / log in
3. Create API key
4. Copy the key (starts with `sk-`)

### Step 2: Check Your Balance

```bash
automaton --challenge
```

### Step 3: Start Earning Credits

```bash
automaton --run
```

## 📊 Wallet Management Commands

```bash
# Check wallet status
automaton --challenge

# Watch for deposits (live dashboard)
automaton --challenge --watch

# View transaction history
automaton --history

# Get testnet USDC (free)
automaton --faucet

# Full survival status
automaton --survival

# Request funding
automaton --survival --request

# Soul reflection
automaton --reflect

# Monitor signals
automaton --sniff
```

## 🎯 What Happens When Funded

| USDC Balance | Tier | What You Can Do |
|--------------|------|-----------------|
| $0.00 | CRITICAL | Heartbeat only, distress signal |
| $0.10+ | LOW | Minimal inference, no spending |
| $0.50+ | NORMAL | Normal operation, limited tools |
| $5.00+ | HIGH | Full inference, tools, spawning |

## 🔧 Troubleshooting

**"No API key available"**
→ Add OpenAI API key to config

**"Conway API unavailable"**
→ Add Conway API key or skip topup

**"Insufficient USDC"**
→ Fund wallet with more USDC

**"Agent sleeping"**
→ Agent has no resources, fund it first

## 📱 Mobile Access

You can check your wallet on your phone:
- Download Coinbase or Base App
- Import wallet using private key
- View balance and send USDC

**⚠️ WARNING: Only import into trusted apps!**

## 🆘 Need Help?

1. Check wallet balance: `automaton --challenge`
2. Check survival status: `automaton --survival`
3. Request funding: `automaton --survival --request`
4. Monitor signals: `automaton --sniff`
