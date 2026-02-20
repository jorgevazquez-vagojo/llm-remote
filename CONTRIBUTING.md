# Contribuir a LLM Remote

Gracias por tu interés en contribuir. Este documento explica cómo hacerlo.

## Requisitos

- Node.js 20+
- npm

## Configurar entorno de desarrollo

```bash
git clone <repo-url>
cd llm-remote
npm install
cp .env.example .env
# Edita .env con tus valores
npm run dev
```

## Tests

```bash
npm test
```

Todos los tests deben pasar antes de enviar un PR.

## Estructura del código

```
src/
├── providers/    # Proveedores IA (añadir nuevos aquí)
├── auth/         # Autenticación y sesiones
├── crypto/       # Cifrado AES-256-GCM
├── security/     # Rate limiting y audit log
├── claude/       # Formateo de salida
└── utils/        # Config, logger, keygen
```

## Añadir un nuevo proveedor IA

1. Crea `src/providers/mi-provider.js` extendiendo `BaseProvider`
2. Implementa `execute(prompt, context)`, `displayName`, `isConfigured`
3. Regístralo en `src/providers/manager.js`
4. Añade las variables de entorno en `src/utils/config.js`
5. Actualiza el wizard en `src/setup.js`

## Convenciones

- **Código**: en inglés
- **Interfaz de usuario** (mensajes al usuario): en español
- **Commits**: en español, descriptivos
- **Sin dependencias nativas**: solo JS puro + npm packages JS
- **Seguridad**: nunca hardcodear secretos, siempre variables de entorno

## Reportar bugs

Abre un issue describiendo:
1. Qué esperabas que pasara
2. Qué pasó realmente
3. Pasos para reproducir
4. Sistema operativo y versión de Node.js
