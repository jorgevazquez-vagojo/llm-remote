<p align="center">
  <img src="docs/logo.svg" alt="LLM Remote" width="120">
</p>

<h1 align="center">LLM Remote</h1>

<p align="center">
  <strong>Encrypted Telegram ↔ AI Multi-Provider Bridge</strong><br>
  Control Claude Code, OpenAI, Gemini, Groq & Anthropic from Telegram with bank-grade encryption.
</p>

<p align="center">
  <a href="https://github.com/jorgevazquez-vagojo/llm-remote/actions/workflows/ci.yml"><img src="https://github.com/jorgevazquez-vagojo/llm-remote/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/jorgevazquez-vagojo/llm-remote/releases"><img src="https://img.shields.io/github/v/release/jorgevazquez-vagojo/llm-remote?color=6c5ce7" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-00d4aa" alt="License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/dependencies-2-blue" alt="Dependencies">
  <img src="https://img.shields.io/badge/tests-53%20passing-success" alt="Tests">
</p>

<p align="center">
  <a href="docs/manual.html">Manual ES</a> ·
  <a href="docs/manual_en.html">Manual EN</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="SECURITY.md">Security</a>
</p>

---

## Features

### AI Providers

| Provider | Command | Mode | Cost |
|----------|---------|------|------|
| Claude Code | `/ia claude` | **Agentic** — reads/writes files, runs commands | Plan-based |
| OpenAI GPT-4o | `/ia openai` | Chat API + Vision | Pay-per-use |
| Gemini 2.5 Flash | `/ia gemini` | Chat API + Vision | **Free** (20 req/day) |
| Groq Llama 3.3 | `/ia groq` | Chat API + Whisper + TTS | **Free** (30 req/min) |
| Anthropic Sonnet | `/ia anthropic` | Chat API + Vision | Pay-per-use |

Switch providers instantly with `/ia <name>` in Telegram.

### Capabilities

| Feature | Description |
|---------|-------------|
| **Voice messages** | Send audio → transcription (Groq Whisper, free) + AI response |
| **Photo analysis** | Send photos → Vision analysis (GPT-4o / Claude / Gemini fallback) |
| **File processing** | Send code, CSV, PDF → AI analysis (20+ formats) |
| **Text-to-Speech** | `/voz` toggle — receive AI responses as voice notes |
| **Web search** | `/web <query>` — DuckDuckGo search + AI summary (no API key) |
| **Pipelines** | `/pipe step1 → step2 → step3` — chain AI operations |
| **Scheduled tasks** | `/schedule 24h <prompt>` — periodic AI execution |
| **SSH remote** | `/ssh prod df -h` — execute commands on remote servers |
| **MCP servers** | `/mcp add <name> <cmd>` — connect Model Context Protocol tools |
| **Telegram groups** | Works in groups: responds to commands, @mentions, and replies |
| **Conversation memory** | 20-message context per user, clear with `/clear` |
| **Multi-project** | `/project ~/my-app` — switch working directories |

### Security (8-layer model)

```
Telegram (MTProto) → Whitelist → PIN → Anti-bruteforce → Session
                                                            ↓
                     Auto-delete ← AES-256-GCM ← Rate limit
```

- **AES-256-GCM** authenticated encryption with HMAC-SHA256 integrity
- **PBKDF2** key derivation (310,000 iterations + SHA-512)
- Random 16-byte IV + 32-byte salt per message
- Constant-time PIN comparison (timing attack prevention)
- 5 failed attempts → 15-minute lockout
- Encrypted audit log (append-only NDJSON)
- Auto-delete messages (optional)

## Quick Start

```bash
# Clone
git clone https://github.com/jorgevazquez-vagojo/llm-remote.git
cd llm-remote

# Install (only 2 dependencies: grammy + dotenv)
npm install

# Configure (interactive wizard)
npm run setup

# Run
npm start
```

Or use the corporate installer:

```bash
bash installer.sh
```

### Requirements

- **Node.js 20+** — `brew install node` or [nodejs.org](https://nodejs.org)
- **Telegram bot token** — from [@BotFather](https://t.me/BotFather)
- **Your Telegram User ID** — send `/myid` to [@userinfobot](https://t.me/userinfobot)
- **Claude Code CLI** (optional) — `npm i -g @anthropic-ai/claude-code`

### Free API keys (optional)

| Provider | URL | Why |
|----------|-----|-----|
| Groq | [console.groq.com/keys](https://console.groq.com/keys) | Free chat + voice transcription + TTS |
| Gemini | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Free chat + vision (20 req/day) |

## Usage

### In Telegram

```
1. /start                    → See all features
2. /auth <PIN>               → Authenticate (message auto-deletes)
3. "Explain closures in JS"  → AI responds with context memory
4. /ia groq                  → Switch to Groq (free, <1s response)
5. [send voice note]         → Transcription + AI response
6. [send photo]              → Vision analysis
7. /web latest React news    → Web search + AI summary
8. /ssh prod docker ps       → Remote server command
9. /voz                      → Toggle voice responses (TTS)
10. /pipe search X → summarize → Pipeline execution
```

### Command Reference

| Command | Description |
|---------|-------------|
| `/auth <PIN>` | Authenticate (auto-deletes) |
| `/ia [name]` | View/switch AI provider |
| `/ask <prompt>` | Explicit prompt |
| `/clear` | Clear conversation context |
| `/project [path]` | View/change working directory |
| `/status` | Session, provider, TTS, SSH info |
| `/history` | Last 15 audit log entries |
| `/kill` | Kill running process |
| `/lock` | Lock session |
| `/voz` | Toggle TTS voice responses |
| `/web <query>` | Web search + AI summary |
| `/schedule <interval> <prompt>` | Create scheduled task |
| `/schedules` | List scheduled tasks |
| `/unschedule <id>` | Delete scheduled task |
| `/pipe step1 → step2` | Execute pipeline |
| `/mcp` | Manage MCP servers |
| `/ssh` | SSH remote management |
| `/help` | Show all commands |
| *(free text)* | Send directly to active provider |
| *(voice/photo/file)* | Transcription / Vision / Analysis |

## Architecture

```
llm-remote/
├── src/
│   ├── index.js              # Entry point
│   ├── bot.js                # Telegram bot + 22 handlers
│   ├── setup.js              # Interactive configurator
│   ├── auth/                 # Whitelist, sessions, groups
│   ├── crypto/               # AES-256-GCM + HMAC + PBKDF2
│   ├── providers/            # Claude, OpenAI, Gemini, Groq, Anthropic
│   ├── context/              # Conversational memory (20 msgs)
│   ├── media/                # Voice (Whisper), Vision, Files, TTS
│   ├── search/               # Web search (DuckDuckGo)
│   ├── scheduler/            # Periodic task execution
│   ├── pipeline/             # Multi-step pipeline engine
│   ├── mcp/                  # MCP client (JSON-RPC stdio)
│   ├── remote/               # SSH execution + safety
│   ├── claude/               # Telegram message chunking
│   ├── security/             # Rate limiting + encrypted audit
│   └── utils/                # Config, logger, keygen
├── tests/                    # 53 tests across 7 suites
├── docs/                     # Manuals ES/EN (HTML + PDF)
├── installer.sh              # Corporate installer
└── package.json              # Only 2 deps: grammy + dotenv
```

**Zero native dependencies.** Only 2 production packages. Everything else uses Node.js built-ins (`node:crypto`, `node:child_process`, `fetch`).

## Testing

```bash
npm test
# 53 tests across 7 suites: crypto, memory, files, search, pipeline, tts, ssh
```

## Environment Variables

See [`.env.example`](.env.example) for all options. Key variables:

| Variable | Required | Description |
|----------|:--------:|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot token |
| `AUTHORIZED_USERS` | Yes | Comma-separated Telegram IDs |
| `AUTH_PIN` | Yes | Authentication PIN |
| `MASTER_PASSWORD` | Yes | Master encryption password (16+ chars) |
| `OPENAI_API_KEY` | No | OpenAI (chat + vision + TTS) |
| `GEMINI_API_KEY` | No | Google Gemini (free) |
| `GROQ_API_KEY` | No | Groq (free chat + whisper + TTS) |
| `ANTHROPIC_API_KEY` | No | Anthropic |

## Documentation

- [Manual (Spanish)](docs/manual.html) · [PDF](docs/LLM_Remote_Manual.pdf)
- [Manual (English)](docs/manual_en.html) · [PDF](docs/LLM_Remote_Manual_EN.pdf)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)

## License

[MIT](LICENSE) — Redegal, Digital Consulting Group
