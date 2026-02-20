# LLM Remote — Project Instructions

## MANDATORY: Documentation Updates

**Every time a feature is added, modified, or removed, the following files MUST be updated:**

1. `docs/manual.html` — Spanish manual (14 sections, v2.1+)
2. `docs/manual_en.html` — English manual (14 sections, v2.1+)
3. `CHANGELOG.md` — Version history
4. `package.json` — Version number (semver)

### What to update in manuals:
- **New command** → Add to Section 10 (Command Reference table) + relevant feature section
- **New feature** → Add new section or update existing one (Multimedia, Tools, SSH, Groups)
- **Changed behavior** → Update usage examples and descriptions
- **New env variable** → Add to Section 14 (Environment Variables table)
- **New troubleshooting case** → Add to Section 13 (Troubleshooting table)
- **Architecture change** → Update Section 12 (project structure tree, stack table)
- **Version bump** → Update cover page meta, footer, and /start + /help in bot.js

### Manual structure (both ES and EN):
1. Introduction
2. AI Providers
3. Installation
4. Configuration
5. Usage from Telegram
6. Multimedia: Voice, Photos, Files
7. Advanced Tools (web search, schedules, pipelines, MCP)
8. SSH Remote
9. Telegram Groups
10. Command Reference
11. Security Architecture
12. Technical Architecture
13. Troubleshooting
14. Environment Variables

### PDF generation:
After updating HTML manuals, regenerate PDFs:
```bash
# macOS — open in browser and print to PDF
# Or use any HTML-to-PDF tool
```

## Project Overview

- **LLM Remote** v2.2 — Encrypted Telegram ↔ AI multi-provider bridge
- Node.js 20+ ESM, grammY, only 2 production deps (grammy, dotenv)
- 5 AI providers: Claude Code (agentic), OpenAI, Gemini, Groq, Anthropic
- Features: voice, vision, files, persona, web search, schedules, pipelines, MCP, SSH, groups
- 61 tests across 8 suites

## Code Conventions

- Language: English for code, Spanish for user-facing messages in Telegram
- ESM modules (`"type": "module"`)
- Native fetch for all HTTP calls (no axios/got)
- Native node:crypto for all crypto (no external libs)
- Native ssh for remote execution (no ssh2 lib)
- Error messages in Spanish for Telegram responses
- Log messages in English with module prefix: `[ssh]`, `[tts]`, `[voice]`

## Testing

```bash
npm test  # Runs all 61 tests
```

Test files: `tests/*.test.js` using `node:test` + `node:assert/strict`

## Remotes

- GitHub: `origin` → github.com/jorgevazquez-vagojo/llm-remote
- GitLab: `gitlab` → git.redegal.net/jorge.vazquez/llm-remote
- Always push to both: `git push origin main && git push gitlab main`

## MANDATORY: Deploy to Production

**Every time code is pushed to GitHub/GitLab, ALSO update the running bots on the server:**

Server: `37.27.92.122` (root/pepe2021e5e1a)

### Two bot instances:
1. **Jorge** (@jorge_smart_bot) → `/root/llm-remote-jorge/` container `llm-remote-jorge`
2. **Isa** (@Cruceiros_bot) → `/root/llm-remote-isa/` container `llm-remote-isa`

### Deploy steps (BOTH bots):
```bash
# 1. Sync code (preserving .env and data)
sshpass -p 'pepe2021e5e1a' rsync -avz --delete \
  --exclude='.env' --exclude='data' --exclude='node_modules' --exclude='.git' \
  /Users/jorgevazquez/claude-remote/ root@37.27.92.122:/root/llm-remote-jorge/

sshpass -p 'pepe2021e5e1a' rsync -avz --delete \
  --exclude='.env' --exclude='data' --exclude='node_modules' --exclude='.git' \
  /Users/jorgevazquez/claude-remote/ root@37.27.92.122:/root/llm-remote-isa/

# 2. Fix Isa's container name (rsync overwrites docker-compose.yml)
sshpass -p 'pepe2021e5e1a' ssh root@37.27.92.122 \
  "sed -i 's/container_name: llm-remote-jorge/container_name: llm-remote-isa/' /root/llm-remote-isa/docker-compose.yml"

# 3. Rebuild and restart both
sshpass -p 'pepe2021e5e1a' ssh root@37.27.92.122 \
  "cd /root/llm-remote-jorge && docker compose build --no-cache && docker compose up -d --force-recreate"

sshpass -p 'pepe2021e5e1a' ssh root@37.27.92.122 \
  "cd /root/llm-remote-isa && docker compose build --no-cache && docker compose up -d --force-recreate"

# 4. Verify
sshpass -p 'pepe2021e5e1a' ssh root@37.27.92.122 \
  "docker ps --filter 'name=llm-remote' --format 'table {{.Names}}\t{{.Status}}'"
```

### IMPORTANT:
- NEVER rsync .env files — each bot has its own credentials
- Isa's docker-compose.yml needs `container_name: llm-remote-isa` (rsync copies Jorge's)
- Isa has SYSTEM_PROMPT env for M&A expert persona
- After deploy, check `docker logs llm-remote-jorge --tail 5` and `docker logs llm-remote-isa --tail 5`
