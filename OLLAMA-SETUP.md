# 🖥️ Ollama Setup — 8GB RAM Laptop

## Best Models for 8GB RAM

| Model | RAM Needed | Speed | Quality |
|-------|------------|-------|---------|
| **Phi-3 mini (3.8B)** | ~4GB | ⚡ Fast | ⭐⭐⭐ Good |
| **Gemma 2B** | ~2GB | ⚡⚡ Very Fast | ⭐⭐ OK |
| **TinyLlama (1.1B)** | ~1.5GB | ⚡⚡⚡ Fastest | ⭐ Basic |
| **Llama 3.2 1B** | ~1.5GB | ⚡⚡⚡ Fastest | ⭐ Basic |

## 🎯 Recommended: Phi-3 mini

**Why Phi-3?**
- ✅ Best quality for 8GB RAM
- ✅ Fast inference
- ✅ Good at coding and reasoning
- ✅ Only ~4GB RAM usage

## 📥 Installation Steps

### Step 1: Download Ollama
1. Visit: https://ollama.ai/download
2. Click "Download for Windows"
3. Run the installer
4. Restart computer

### Step 2: Pull Phi-3 Model
```bash
# Open Command Prompt or PowerShell
ollama pull phi3:mini
```
**Download time:** ~5-10 minutes (2.2GB)

### Step 3: Test It
```bash
ollama run phi3:mini
# Type: "Hello, how are you?"
# Press Enter
# Type: /bye to exit
```

### Step 4: Configure Automaton
```bash
# Edit config to use local Ollama
automaton --setup
# Or manually edit: ~/.automaton/automaton.json
```

## ⚡ Performance Tips for 8GB RAM

1. **Close other apps** while running Ollama
2. **Use small context** (2048 tokens)
3. **Avoid multiple models** at once
4. **Monitor RAM usage** in Task Manager

## 🔧 Config for 8GB RAM

```json
{
  "inferenceModel": "phi3:mini",
  "maxTokensPerTurn": 2048,
  "modelStrategy": {
    "budgetHourlyCents": 0,
    "budgetDailyCents": 0
  }
}
```

## 📊 Expected Performance

| Task | Time | RAM Usage |
|------|------|-----------|
| Simple query | 2-3 sec | ~3GB |
| Code generation | 5-10 sec | ~4GB |
| Analysis | 3-5 sec | ~3.5GB |

## 🆘 Troubleshooting

**"Out of memory"**
→ Close other apps, reduce maxTokensPerTurn

**"Model not found"**
→ Run: `ollama pull phi3:mini`

**"Slow response"**
→ Use TinyLlama instead: `ollama pull tinyllama`
