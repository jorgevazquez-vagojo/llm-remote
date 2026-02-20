/**
 * Web search module.
 * Uses DuckDuckGo HTML (no API key needed) + AI summary.
 */
import { log } from '../utils/logger.js';

export async function webSearch(query, maxResults = 5) {
  log.info(`[search] Searching: ${query}`);

  try {
    // Use DuckDuckGo HTML for free, no-key search
    const results = await searchDuckDuckGo(query, maxResults);

    if (results.length === 0) {
      return { results: [], summary: 'No se encontraron resultados.' };
    }

    return { results };
  } catch (err) {
    log.error(`[search] Error: ${err.message}`);
    throw err;
  }
}

async function searchDuckDuckGo(query, maxResults) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  });

  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);

  const html = await res.text();
  const results = [];

  // Parse results from HTML
  const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
    const url = decodeURIComponent(match[1].replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, '').split('&')[0]);
    const title = match[2].replace(/<[^>]*>/g, '').trim();

    // Get corresponding snippet
    const snippetMatch = snippetRegex.exec(html);
    const snippet = snippetMatch
      ? snippetMatch[1].replace(/<[^>]*>/g, '').trim()
      : '';

    if (title && url.startsWith('http')) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

export function formatSearchResults(results) {
  if (results.length === 0) return 'No se encontraron resultados.';

  return results.map((r, i) =>
    `${i + 1}. **${r.title}**\n   ${r.snippet}\n   🔗 ${r.url}`
  ).join('\n\n');
}
