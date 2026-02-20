import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatSearchResults } from '../src/search/web.js';

describe('Web Search', () => {
  describe('formatSearchResults', () => {
    it('formats results correctly', () => {
      const results = [
        { title: 'Node.js', url: 'https://nodejs.org', snippet: 'JS runtime' },
        { title: 'Deno', url: 'https://deno.land', snippet: 'Secure runtime' },
      ];
      const formatted = formatSearchResults(results);
      assert.ok(formatted.includes('Node.js'));
      assert.ok(formatted.includes('https://nodejs.org'));
      assert.ok(formatted.includes('JS runtime'));
      assert.ok(formatted.includes('Deno'));
      assert.ok(formatted.includes('1.'));
      assert.ok(formatted.includes('2.'));
    });

    it('handles empty results', () => {
      const formatted = formatSearchResults([]);
      assert.ok(formatted.includes('No se encontraron'));
    });

    it('handles single result', () => {
      const results = [{ title: 'Test', url: 'https://test.com', snippet: 'A test' }];
      const formatted = formatSearchResults(results);
      assert.ok(formatted.includes('1.'));
      assert.ok(!formatted.includes('2.'));
    });
  });
});
