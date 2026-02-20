import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canProcessFile, extractFileContent } from '../src/media/files.js';

describe('File Processing', () => {
  describe('canProcessFile', () => {
    it('accepts JavaScript files', () => {
      assert.equal(canProcessFile('app.js', 1000), true);
    });

    it('accepts TypeScript files', () => {
      assert.equal(canProcessFile('index.ts', 1000), true);
    });

    it('accepts Python files', () => {
      assert.equal(canProcessFile('main.py', 1000), true);
    });

    it('accepts CSV files', () => {
      assert.equal(canProcessFile('data.csv', 1000), true);
    });

    it('accepts JSON files', () => {
      assert.equal(canProcessFile('config.json', 1000), true);
    });

    it('accepts YAML files', () => {
      assert.equal(canProcessFile('config.yaml', 1000), true);
    });

    it('accepts Markdown files', () => {
      assert.equal(canProcessFile('README.md', 1000), true);
    });

    it('accepts PDF files', () => {
      assert.equal(canProcessFile('doc.pdf', 1000), true);
    });

    it('accepts SQL files', () => {
      assert.equal(canProcessFile('schema.sql', 1000), true);
    });

    it('rejects unknown extensions', () => {
      assert.equal(canProcessFile('video.mp4', 1000), false);
    });

    it('rejects files over 5MB', () => {
      assert.equal(canProcessFile('big.js', 6 * 1024 * 1024), false);
    });

    it('accepts files exactly at 5MB', () => {
      assert.equal(canProcessFile('ok.js', 5 * 1024 * 1024), true);
    });
  });

  describe('extractFileContent', () => {
    it('extracts text from JS file', async () => {
      const buffer = Buffer.from('const x = 42;\nconsole.log(x);');
      const content = await extractFileContent(buffer, 'test.js');
      assert.equal(content, 'const x = 42;\nconsole.log(x);');
    });

    it('extracts and formats CSV preview', async () => {
      const csv = 'name,age\nAlice,30\nBob,25';
      const buffer = Buffer.from(csv);
      const content = await extractFileContent(buffer, 'data.csv');
      assert.ok(content.includes('data.csv'));
      assert.ok(content.includes('3 filas'));
      assert.ok(content.includes('name,age'));
    });

    it('truncates large CSV files', async () => {
      const lines = ['col1,col2'];
      for (let i = 0; i < 100; i++) lines.push(`val${i},val${i}`);
      const buffer = Buffer.from(lines.join('\n'));
      const content = await extractFileContent(buffer, 'big.csv');
      assert.ok(content.includes('filas más'));
    });

    it('handles empty files', async () => {
      const buffer = Buffer.from('');
      const content = await extractFileContent(buffer, 'empty.txt');
      assert.equal(content, '');
    });

    it('handles unicode content', async () => {
      const buffer = Buffer.from('¡Hola! 日本語 العربية');
      const content = await extractFileContent(buffer, 'unicode.txt');
      assert.ok(content.includes('¡Hola!'));
    });
  });
});
