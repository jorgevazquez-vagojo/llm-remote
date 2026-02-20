const TELEGRAM_MAX = 4096;

/**
 * Divide texto largo en trozos seguros para Telegram,
 * respetando bloques de código y saltos de línea.
 */
export function splitMessage(text, maxLen = TELEGRAM_MAX - 100) {
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Intentar cortar en un salto de línea cerca del límite
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.5) {
      // Si no hay buen salto, cortar en espacio
      splitAt = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitAt < maxLen * 0.3) {
      // Corte duro
      splitAt = maxLen;
    }

    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trimStart();
  }

  return chunks;
}

/**
 * Escapar caracteres especiales para Telegram MarkdownV2
 */
export function escapeMarkdown(text) {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * Formatear salida para Telegram con números de trozo
 */
export function formatOutput(text, label = 'Respuesta') {
  const chunks = splitMessage(text);

  if (chunks.length === 1) {
    return [chunks[0]];
  }

  return chunks.map((chunk, i) => {
    const header = `📄 ${label} [${i + 1}/${chunks.length}]\n\n`;
    return header + chunk;
  });
}

/**
 * Formatear mensaje de estado
 */
export function formatStatus(info) {
  return [
    '📊 Estado de sesión',
    `├ Directorio: ${info.workDir}`,
    `├ Autenticado: ${info.authenticatedAt}`,
    `├ Última actividad: ${info.lastActivity}`,
    `└ Expira en: ${info.timeoutIn}`,
  ].join('\n');
}
