# 🧬 Automaton Survival Challenge

**Zero-cost web intelligence platform with multi-provider AI inference.**

A sovereign AI agent runtime that searches the web, extracts content, and summarizes information using 100% free APIs — no local LLM, no GPU, no credit card.

## Features

| Feature | Status | Cost |
|---------|--------|------|
| **Multi-Provider AI Router** | ✅ | Free (Groq, HuggingFace, Deepseek, Gemini) |
| **DuckDuckGo Search** | ✅ | Free (no API key) |
| **Web Extractor** | ✅ | Free (Cheerio + Playwright) |
| **Research Pipeline** | ✅ | Free (search → extract → summarize) |
| **HTTP API** | ✅ | Free |
| **Streaming Chat** | ✅ | Free |
| **Opinion Engine** | ✅ | Free |
| **Balance Dashboard** | ✅ | Free |
| **GitHub Actions CI** | ✅ | Free |

## Architecture

```
User Query
    ↓
┌─────────────────┐
│  DuckDuckGo     │  ← Free search (no API key)
│  Search         │
└────────┬────────┘
         ↓
┌─────────────────┐
│  Web Extractor  │  ← Cheerio (fast) + Playwright (JS pages)
└────────┬────────┘
         ↓
┌─────────────────┐
│  LLM Router     │  ← Tries providers in priority order:
│  (fallback)     │     Groq → HuggingFace → Deepseek → Gemini
└────────┬────────┘
         ↓
    Summary + Sources
```

## Quick Start

```bash
# Clone
git clone https://github.com/kingpo39/-Automaton-Survival-Challenge-.git
cd -Automaton-Survival-Challenge-

# Install
npm install

# Set API keys (any one works, Groq recommended)
set GROQ_API_KEY=gsk_your_key_here
# OR
set HUGGINGFACE_API_KEY=hf_xxx

# Start API server
npm run api

# Test
curl http://localhost:3001/health
curl -X POST http://localhost:3001/search -H "Content-Type: application/json" -d '{"query":"AI news"}'
curl -X POST http://localhost:3001/analyze -H "Content-Type: application/json" -d '{"query":"what is TypeScript"}'
```

## API Endpoints

| Method | Endpoint | Description | Free? |
|--------|----------|-------------|-------|
| `GET` | `/health` | Provider status + rate limits | ✅ |
| `GET` | `/providers` | Available providers | ✅ |
| `POST` | `/search` | DuckDuckGo search | ✅ |
| `POST` | `/extract` | Web page extraction | ✅ |
| `POST` | `/analyze` | Full pipeline (search + extract + LLM) | ✅ |

## Free Tier Limits

| Provider | Limit | Speed |
|----------|-------|-------|
| **Groq** | 100 req/day | ~1-3 sec |
| **HuggingFace** | 30k req/month | ~5-10 sec |
| **Deepseek** | 1k req/day | ~3-5 sec |
| **Gemini** | 1500 req/day | ~2-4 sec |
| **DuckDuckGo** | Unlimited | ~1 sec |
| **Cheerio** | Unlimited | ~0.5 sec |

**Combined daily capacity: ~2,600+ LLM requests + unlimited search**

## Project Structure

```
src/
├── providers/          # Multi-provider AI inference
│   ├── index.ts        # Router with fallback chain
│   ├── groq.ts         # Groq (fastest)
│   ├── huggingface.ts  # HuggingFace (most generous)
│   ├── deepseek.ts     # Deepseek (good reasoning)
│   └── gemini.ts       # Gemini (backup)
├── services/           # Core services
│   ├── api-server.ts   # HTTP API
│   ├── pipeline.ts     # Search → Extract → Infer
│   ├── search.ts       # DuckDuckGo search
│   └── web-extractor.ts # Cheerio + Playwright
├── platform-config.ts  # API key management
├── agent/              # Agent loop + tools
├── survival/           # Survival tier system
├── opinion/            # Sentiment engine
└── dashboard-server.ts # WebSocket dashboard
```

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Web Extraction:** Cheerio (fast HTML) + Playwright (JS rendering)
- **Search:** DuckDuckGo (no API key)
- **LLM:** Groq, HuggingFace, Deepseek, Gemini (all free tiers)
- **API:** Native Node.js HTTP server
- **CI:** GitHub Actions

## License

MIT
