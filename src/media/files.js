/**
 * File processing for documents sent via Telegram.
 * Extracts text content from various file types.
 */
import { log } from '../utils/logger.js';

const TEXT_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.php', '.sh', '.bash', '.zsh',
  '.html', '.css', '.scss', '.less', '.xml', '.svg',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.md', '.txt', '.rst', '.log', '.env', '.gitignore', '.dockerignore',
  '.sql', '.graphql', '.prisma',
  '.csv', '.tsv',
  '.dockerfile', '.makefile',
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB max

export function canProcessFile(fileName, fileSize) {
  if (fileSize > MAX_FILE_SIZE) return false;
  const ext = getExtension(fileName);
  return TEXT_EXTENSIONS.has(ext) || ext === '.pdf';
}

export async function extractFileContent(fileBuffer, fileName) {
  const ext = getExtension(fileName);

  if (ext === '.pdf') {
    return extractPdfText(fileBuffer);
  }

  if (ext === '.csv' || ext === '.tsv') {
    return formatCsvPreview(fileBuffer.toString('utf-8'), fileName);
  }

  // All text files
  return fileBuffer.toString('utf-8');
}

function getExtension(fileName) {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.substring(dot).toLowerCase() : '';
}

function formatCsvPreview(text, fileName) {
  const lines = text.split('\n');
  const totalRows = lines.length;
  const preview = lines.slice(0, 50).join('\n');
  const truncated = totalRows > 50 ? `\n\n... (${totalRows - 50} filas más)` : '';
  return `📊 ${fileName} (${totalRows} filas):\n\n${preview}${truncated}`;
}

function extractPdfText(buffer) {
  // Basic PDF text extraction without external dependencies.
  // Extracts text from stream objects — works for most text-based PDFs.
  try {
    const text = buffer.toString('latin1');
    const chunks = [];

    // Find text between BT and ET operators
    const btRegex = /BT\s([\s\S]*?)ET/g;
    let match;
    while ((match = btRegex.exec(text)) !== null) {
      const block = match[1];
      // Extract text from Tj, TJ, ' operators
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        chunks.push(tjMatch[1]);
      }
      // TJ array
      const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
      let arrMatch;
      while ((arrMatch = tjArrayRegex.exec(block)) !== null) {
        const inner = arrMatch[1];
        const strRegex = /\(([^)]*)\)/g;
        let strMatch;
        while ((strMatch = strRegex.exec(inner)) !== null) {
          chunks.push(strMatch[1]);
        }
      }
    }

    if (chunks.length === 0) {
      return '(PDF sin texto extraíble — puede ser un PDF escaneado/imagen)';
    }

    return chunks.join(' ')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, ' ')
      .substring(0, 50000);
  } catch (err) {
    log.warn(`[files] PDF extraction error: ${err.message}`);
    return '(Error extrayendo texto del PDF)';
  }
}
