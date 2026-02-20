# Changelog

Todos los cambios notables de este proyecto se documentan aquí.

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
