const TELEGRAM_MAX = 4096;

/**
 * Split long text into Telegram-safe chunks, respecting code blocks and line breaks.
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

    // Try to split at a newline near the limit
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.5) {
      // If no good newline, split at space
      splitAt = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitAt < maxLen * 0.3) {
      // Hard split
      splitAt = maxLen;
    }

    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trimStart();
  }

  return chunks;
}

/**
 * Escape special characters for Telegram MarkdownV2
 */
export function escapeMarkdown(text) {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * Format Claude output for Telegram with chunk numbers
 */
export function formatOutput(text, label = 'Response') {
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
 * Format status message
 */
export function formatStatus(info) {
  return [
    '📊 Session Status',
    `├ Work dir: ${info.workDir}`,
    `├ Authenticated: ${info.authenticatedAt}`,
    `├ Last activity: ${info.lastActivity}`,
    `└ Timeout in: ${info.timeoutIn}`,
  ].join('\n');
}
