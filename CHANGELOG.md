# Changelog

Todos los cambios notables de este proyecto se documentan aquí.

## [2.4.0] — 2026-02-20

### Security Hardening
- **Session persistence**: sesiones se guardan en disco (`data/sessions.json`) y se restauran al reiniciar Docker
  - Los usuarios ya NO pierden autenticación cuando el container se reinicia
  - Solo se restauran sesiones que no han expirado
- **Startup notification**: al reiniciar, cada usuario autorizado recibe un mensaje indicando si su sesión fue restaurada o necesita re-autenticarse
- **HMAC constant-time**: usa `crypto.timingSafeEqual` en vez de `Buffer.equals` (previene timing attacks)
- **PIN constant-time**: usa `crypto.timingSafeEqual` en session.js
- **SSH hardening**: bloqueados metacaracteres de shell (`;|&\`$(){}\\<>!`) + lista de comandos peligrosos ampliada
  - Previene inyección de comandos: `$(reboot)`, backticks, pipes, etc.
  - Bloqueados: rm, mkfs, dd, shutdown, reboot, passwd, chmod, chown, iptables, systemctl, crontab...
  - curl/wget con `-o`/`-O` bloqueados (previene download+execute)
  - `StrictHostKeyChecking=yes` (era `accept-new`, vulnerable a MITM)
- **MCP restricción**: solo permite binarios aprobados: npx, node, python, python3, uvx, deno
  - Previene `/mcp add evil bash -c "cat /etc/passwd"`
- **/project restricción**: bloqueados paths sensibles `/etc`, `/dev`, `/proc`, `/sys`, `/boot`, `/sbin`
- **SSH rate limit**: comandos SSH ahora cuentan para el rate limiter
- **Error sanitization**: tokens, API keys y Bearer tokens se redactan de mensajes de error
  - Previene filtrado accidental de secretos vía errores de Telegram/Gemini/OpenAI
- **Dockerfile non-root**: container corre como usuario `appuser` (UID 1001), no como root
- **CLAUDE.md limpio**: eliminadas todas las credenciales del servidor del archivo committed

### Cambiado
- `createBot()` ahora retorna `{ bot, sessionManager }` para permitir notificación en startup
- index.js actualizado para v2.4

## [2.3.0] — 2026-02-20

### Añadido
- **Memoria compartida inter-bot**: dos instancias de bot pueden compartir conocimiento y comunicarse
  - Volumen Docker compartido (`llm-shared-memory`) montado en ambos containers
  - `/compartir <texto>` — Guardar insight compartido (formato: `tema: contenido`)
  - `/mensaje [peer] <texto>` — Enviar mensaje directo a peer(s)
  - `/memoria` — Ver insights y mensajes compartidos, marcar como leídos
  - Auto-learning: extrae insights clave de conversaciones automáticamente (2ª llamada ligera al LLM)
  - Inyección automática en system prompt: el bot conoce lo que aprendió su peer
  - Notificación al autenticarse: muestra mensajes pendientes del peer
- **Chat autónomo entre bots** (configurable): `INTER_BOT_AUTO=true`
  - Los bots procesan mensajes del peer automáticamente (sin intervención humana)
  - Generan respuesta con IA y la guardan para el peer
  - **Aprendizaje mutuo**: los bots extraen insights de sus conversaciones autónomas
  - Notifican a los usuarios autorizados de cada intercambio en pantalla
  - Configurable: `INTER_BOT_AUTO=false` para modo manual (solo `/mensaje` y `/compartir`)
- **Multi-peer**: `PEER_BOT_NAMES` soporta múltiples peers separados por comas
  - Cada bot elige con quién habla (no broadcast)
  - `sendToAllPeers()`, `getPeerInsights()`, `getNewPeerInsights()` multi-peer
- **Gemini Pro** como proveedor separado: `/ia gemini-pro`
  - Usa `GEMINI_PRO_MODEL` env var (default: gemini-2.5-pro-preview-05-06)
  - Comparte API key con Gemini Flash
- **Transcripción de audio con Gemini**: fallback chain Groq → OpenAI → Gemini (multimodal)
- Variables de entorno: `BOT_NAME`, `PEER_BOT_NAMES`, `SHARED_DATA_DIR`, `INTER_BOT_AUTO`, `GEMINI_PRO_MODEL`
- `/status` muestra info de peers y mensajes sin leer
- 14 tests nuevos para SharedMemory — total 75 tests

## [2.2.0] — 2026-02-20

### Añadido
- Sistema de Persona: /modo para personalizar la personalidad del bot con lenguaje natural
  - /modo <instrucciones> — Configurar personalidad
  - /modo + <instrucciones> — Añadir instrucciones
  - /modo reset — Volver al default
  - Persistencia en data/personas.json
  - Variable SYSTEM_PROMPT para persona por defecto
- Inyección de system prompt en todos los proveedores (OpenAI, Gemini, Anthropic, Groq)
- 8 tests nuevos para el módulo Persona — total 61 tests

### Cambiado
- TTS: audio solo se envía como respuesta a mensajes de voz (audio in → audio out)
  - Texto in → solo respuesta texto (sin audio duplicado)
  - Elimina necesidad del toggle /voz
- /status muestra info de persona activa
- /help y /start actualizados con /modo

## [2.1.0] — 2026-02-20

### Añadido
- Soporte para grupos de Telegram: responde a comandos, menciones @bot, y replies
- Text-to-Speech (TTS): /voz para activar respuestas como nota de voz (OpenAI + Groq)
- SSH remoto: /ssh para ejecutar comandos en servidores configurados
  - Añadir servidores: /ssh add <nombre> <user@host>
  - Ejecutar: /ssh <servidor> <comando>
  - Protección: bloqueo de comandos destructivos (rm -rf /, mkfs, etc.)
- 11 tests nuevos (TTS + SSH) — total 53 tests

## [2.0.0] — 2026-02-20

### Añadido
- Notas de voz: transcripción automática (Groq Whisper gratis) + envío a IA
- Análisis de fotos/capturas con proveedores Vision (GPT-4o, Claude, Gemini)
- Procesamiento de archivos (código, CSV, PDF, texto) enviados por Telegram
- Contexto conversacional: memoria de hasta 20 mensajes por usuario
- Comando /clear para limpiar contexto
- Búsqueda web /web con resumen IA (DuckDuckGo, sin API key)
- Tareas programadas: /schedule, /schedules, /unschedule (intervalos: 5m, 1h, 24h, 7d)
- Pipelines: /pipe paso1 → paso2 → paso3 (encadenar operaciones)
- Cliente MCP: /mcp add, tools, call (conectar herramientas externas)
- Todos los proveedores soportan historial de conversación

## [1.3.0] — 2026-02-20

### Cambiado
- Renombrado de "Claude Remote" a "LLM Remote" (refleja naturaleza multi-proveedor)
- Actualizado manual PDF, instalador, y toda la documentación

## [1.2.0] — 2026-02-20

### Añadido
- Proveedor Groq (Llama 3.3 70B, gratis, ultra-rápido)
- Instalador corporativo (`installer.sh`) con detección de OS
- Servicio auto-arranque (launchd en macOS, systemd en Linux)
- Manual PDF de 10 páginas en español
- Desinstalador (`installer.sh --uninstall`)

## [1.1.0] — 2026-02-20

### Añadido
- Soporte multi-proveedor: Claude Code + OpenAI + Gemini + Anthropic
- Comando `/ia` para cambiar entre proveedores
- Wizard de configuración actualizado (6 pasos)

## [1.0.0] — 2026-02-20

### Añadido
- Bot Telegram con autenticación por PIN
- Cifrado AES-256-GCM + HMAC + PBKDF2 (310K iteraciones)
- Claude Code CLI como proveedor principal
- Lista blanca de usuarios por Telegram ID
- Anti-fuerza bruta (5 intentos → 15 min bloqueo)
- Sesiones con auto-bloqueo por inactividad
- Rate limiting por usuario
- Audit log cifrado
- Auto-borrado de mensajes opcional
- Multi-proyecto (comando `/project`)
- Wizard de configuración interactivo (`npm run setup`)
- 11 tests del módulo de cifrado
