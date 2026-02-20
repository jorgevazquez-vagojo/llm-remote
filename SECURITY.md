# Política de Seguridad

## Versiones soportadas

| Versión | Soporte |
|---------|---------|
| 1.x     | ✅ Activo |

## Reportar una vulnerabilidad

Si descubres una vulnerabilidad de seguridad, **NO abras un issue público**.

Envía un correo a: **jorge@redegal.com**

Incluye:
- Descripción de la vulnerabilidad
- Pasos para reproducir
- Impacto potencial
- Sugerencia de solución (si la tienes)

Responderemos en un plazo máximo de 48 horas.

## Modelo de seguridad

Claude Remote implementa 8 capas de seguridad:

1. **Transporte**: Telegram MTProto (cifrado en tránsito)
2. **Lista blanca**: Solo Telegram IDs autorizados
3. **PIN**: Comparación en tiempo constante
4. **Anti-fuerza bruta**: 5 intentos → 15 min bloqueo
5. **Sesiones**: Auto-bloqueo por inactividad
6. **Rate limiting**: Máximo comandos por minuto
7. **Cifrado en reposo**: AES-256-GCM + HMAC-SHA256 + PBKDF2
8. **Auto-borrado**: Eliminación opcional de mensajes

## Buenas prácticas

- Nunca compartas tu `.env` ni tu PIN
- Usa un PIN de al menos 6 caracteres
- Revisa periódicamente el historial con `/history`
- Bloquea la sesión con `/lock` cuando no la uses
- Mantén Node.js actualizado
