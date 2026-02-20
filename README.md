# Claude Remote

**Puente cifrado Telegram ↔ IA (multi-proveedor)**

Controla Claude Code, OpenAI, Gemini y Anthropic desde Telegram, con seguridad de nivel bancario.

## Proveedores IA

| Proveedor | Modo | Coste |
|-----------|------|-------|
| 🟣 **Claude Code CLI** | Agentic (acceso a ficheros, terminal) | Según plan |
| 🟢 **OpenAI GPT-4o** | Chat (API directa) | Pay-per-use |
| 🔵 **Gemini 2.5 Flash** | Chat (API directa) | Gratis (20 req/día) |
| 🟣 **Anthropic Sonnet** | Chat (API directa, no agentic) | Pay-per-use |

Cambia entre proveedores con `/ia` en Telegram.

## Características

- **Multi-proveedor** — Claude Code + OpenAI + Gemini + Anthropic
- **Cifrado AES-256-GCM** con detección de manipulación HMAC
- **Derivación de claves PBKDF2** (310.000 iteraciones, SHA-512)
- **Autenticación por PIN** con bloqueo por fuerza bruta (5 intentos → 15 min lockout)
- **Lista blanca de usuarios** por Telegram ID
- **Sesiones con timeout** auto-lock por inactividad
- **Rate limiting** configurable por minuto
- **Log de auditoría cifrado** de todos los comandos
- **Auto-borrado de mensajes** opcional
- **Multi-proyecto** — cambia de directorio de trabajo sobre la marcha
- **Streaming** — respuestas largas se envían en trozos (Claude Code)
- **Configurador por consola** interactivo
- **Zero dependencias nativas** — solo JS puro + grammY

## Requisitos

- Node.js 20+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) instalado y configurado
- Token de bot de Telegram (de [@BotFather](https://t.me/BotFather))
- Tu Telegram User ID (envía `/myid` a [@userinfobot](https://t.me/userinfobot))

## Instalación

```bash
git clone <repo-url> claude-remote
cd claude-remote
npm install
```

## Configuración

### Opción 1: Wizard interactivo (recomendado)

```bash
npm run setup
```

Esto abre un asistente por consola que te guía paso a paso:

```
╔══════════════════════════════════════╗
║   Claude Remote — Setup Wizard      ║
║   Encrypted Telegram-Claude Bridge  ║
╚══════════════════════════════════════╝

── 1/6  Telegram ──
  Token del bot: <tu-token>
  IDs autorizados: <tu-id>

── 2/6  Seguridad ──
  PIN: <tu-pin>
  Contraseña maestra: <auto-generada>

── 3/6  Sesión y Límites ──
  Timeout: 15 min
  Max comandos/min: 10

── 4/6  Claude Code CLI ──
  Binario: claude
  Directorio: /Users/tu-usuario

── 5/6  Proveedores IA ──
  OpenAI API key: <opcional>
  Gemini API key: <opcional>
  Anthropic API key: <opcional>

── 6/6  Logging ──
  Nivel: info
```

### Opción 2: Manual

```bash
cp .env.example .env
# Edita .env con tus valores
chmod 600 .env
```

## Uso

### Arrancar el bot

```bash
npm start
# o en modo desarrollo (auto-restart):
npm run dev
```

### En Telegram

1. Abre tu bot en Telegram
2. Envía `/start` para ver los comandos
3. Autentícate: `/auth <tu-PIN>`
4. Envía cualquier mensaje — va al proveedor activo (Claude Code por defecto)
5. `/ia openai` — cambia a GPT-4o
6. `/ia gemini` — cambia a Gemini (gratis)
7. `/ia claude` — vuelve a Claude Code

### Comandos disponibles

| Comando | Descripción |
|---------|-------------|
| `/start` | Muestra ayuda inicial |
| `/auth <PIN>` | Autenticarse (el mensaje se borra automáticamente) |
| `/ask <prompt>` | Enviar prompt al proveedor activo |
| `/ia [nombre]` | Ver/cambiar proveedor IA (claude, openai, gemini, anthropic) |
| `/project <ruta>` | Cambiar directorio de trabajo |
| `/status` | Ver estado de sesión y proveedor |
| `/history` | Ver historial de comandos (cifrado) |
| `/kill` | Matar proceso en ejecución |
| `/lock` | Bloquear sesión manualmente |
| `/help` | Ver todos los comandos |

También puedes escribir directamente sin `/ask` — cualquier texto se envía a Claude Code.

## Arquitectura de seguridad

```
Telegram (MTProto) → Bot → Auth Guard → Rate Limit → Claude Code
                              ↓                          ↓
                         PIN + Whitelist          Audit Log Cifrado
                         + Brute-force           (AES-256-GCM)
                           protection
```

### Capas de seguridad

1. **Capa 1 — Transporte**: Telegram usa MTProto (cifrado en tránsito)
2. **Capa 2 — Whitelist**: Solo IDs de Telegram autorizados pueden interactuar
3. **Capa 3 — PIN**: Autenticación por PIN con comparación en tiempo constante
4. **Capa 4 — Anti-bruteforce**: 5 intentos fallidos → bloqueo 15 min
5. **Capa 5 — Sesión**: Auto-lock tras inactividad configurable
6. **Capa 6 — Rate limit**: Máximo de comandos por minuto
7. **Capa 7 — Cifrado at rest**: Todo el audit log cifrado con AES-256-GCM + HMAC
8. **Capa 8 — Auto-delete**: Borrado automático de mensajes (opcional)

### Cifrado

- **Algoritmo**: AES-256-GCM (autenticado)
- **Derivación de clave**: PBKDF2 con 310.000 iteraciones + SHA-512
- **IV**: Aleatorio de 16 bytes por mensaje
- **Salt**: Aleatorio de 32 bytes por mensaje
- **Integridad**: HMAC-SHA256 sobre todo el payload
- **Resultado**: Cada cifrado es único incluso con el mismo texto

## Estructura del proyecto

```
claude-remote/
├── src/
│   ├── index.js           # Punto de entrada
│   ├── bot.js             # Bot Telegram (grammY) + handlers + /ia
│   ├── setup.js           # Configurador interactivo por consola
│   ├── auth/
│   │   ├── guard.js       # Middleware de autenticación + anti-bruteforce
│   │   └── session.js     # Gestión de sesiones + timeout
│   ├── crypto/
│   │   └── cipher.js      # AES-256-GCM + HMAC + PBKDF2
│   ├── providers/
│   │   ├── base.js        # Interfaz base de proveedores
│   │   ├── manager.js     # Gestor multi-proveedor + /ia
│   │   ├── claude.js      # Claude Code CLI (agentic)
│   │   ├── openai.js      # OpenAI GPT-4o (API)
│   │   ├── gemini.js      # Gemini 2.5 Flash (API, gratis)
│   │   └── anthropic.js   # Anthropic Sonnet (API)
│   ├── claude/
│   │   └── formatter.js   # Formateo y chunking para Telegram
│   ├── security/
│   │   ├── ratelimit.js   # Rate limiting por usuario
│   │   └── audit.js       # Log de auditoría cifrado
│   └── utils/
│       ├── config.js      # Configuración centralizada
│       ├── logger.js      # Logger con niveles
│       └── keygen.js      # Generador de contraseñas
├── tests/
│   └── crypto.test.js     # Tests del módulo de cifrado
├── data/                  # Datos cifrados (no en git)
├── install.sh             # Instalador completo
├── .env.example           # Plantilla de configuración
├── .gitignore
└── package.json
```

## Variables de entorno

| Variable | Obligatoria | Descripción |
|----------|:-----------:|-------------|
| `TELEGRAM_BOT_TOKEN` | Sí | Token del bot de Telegram |
| `AUTHORIZED_USERS` | Sí | IDs de usuario autorizados (separados por coma) |
| `MASTER_PASSWORD` | Sí | Contraseña maestra para cifrado (min 16 chars) |
| `AUTH_PIN` | Sí | PIN de autenticación |
| `SESSION_TIMEOUT_MIN` | No | Timeout de sesión en minutos (default: 15) |
| `RATE_LIMIT_PER_MIN` | No | Max comandos por minuto (default: 10) |
| `AUTO_DELETE_SEC` | No | Auto-borrado en segundos (0 = off) |
| `CLAUDE_BIN` | No | Ruta al binario de Claude (default: claude) |
| `DEFAULT_WORK_DIR` | No | Directorio de trabajo por defecto |
| `MAX_CONCURRENT` | No | Procesos Claude simultáneos (default: 2) |
| `OPENAI_API_KEY` | No | API key de OpenAI |
| `OPENAI_MODEL` | No | Modelo OpenAI (default: gpt-4o) |
| `GEMINI_API_KEY` | No | API key de Google Gemini |
| `GEMINI_MODEL` | No | Modelo Gemini (default: gemini-2.5-flash) |
| `ANTHROPIC_API_KEY` | No | API key de Anthropic |
| `ANTHROPIC_MODEL` | No | Modelo Anthropic (default: claude-sonnet-4) |
| `LOG_LEVEL` | No | Nivel de log: debug/info/warn/error |

## Tests

```bash
npm test
```

## Herramientas

```bash
# Generar contraseña maestra
npm run keygen

# Configuración interactiva
npm run setup
```

## Licencia

Uso privado.
