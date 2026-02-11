/**
 * @alfred/skill-pdf-extract
 *
 * Extract text, tables, and searchable content from PDF files.
 * Uses pdf-parse via dynamic import with raw extraction fallback.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolDefinition } from '@alfred/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PDFInfo {
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
  producer?: string;
  creationDate?: string;
  modDate?: string;
}

interface ExtractedText {
  text: string;
  pages: number;
  info: PDFInfo;
  method: 'pdf-parse' | 'raw-extraction';
}

interface TableCell {
  row: number;
  col: number;
  text: string;
}

interface Table {
  pageNumber: number;
  rows: string[][];
  headers: string[] | null;
}

interface SearchMatch {
  text: string;
  pageEstimate: number;
  context: string;
  position: number;
}

// ---------------------------------------------------------------------------
// PDF parsing — dynamic import with fallback
// ---------------------------------------------------------------------------

/**
 * Attempt to load pdf-parse dynamically.
 * Falls back to raw buffer text extraction if unavailable.
 */
async function parsePdf(buffer: Buffer): Promise<{ text: string; numpages: number; info: Record<string, unknown> }> {
  try {
    // Dynamic import of pdf-parse — optional dependency
    const pdfParse = await import('pdf-parse').then((m) => m.default ?? m);
    const result = await pdfParse(buffer);
    return {
      text: result.text,
      numpages: result.numpages,
      info: result.info ?? {},
    };
  } catch {
    // Fallback: raw text extraction from PDF buffer
    return rawExtractText(buffer);
  }
}

/**
 * Raw text extraction from PDF buffer.
 * Extracts readable text strings from the binary PDF content.
 * Not as accurate as pdf-parse but works without dependencies.
 */
function rawExtractText(buffer: Buffer): { text: string; numpages: number; info: Record<string, unknown> } {
  const raw = buffer.toString('latin1');

  // Count pages via /Type /Page entries
  const pageMatches = raw.match(/\/Type\s*\/Page[^s]/g);
  const numpages = pageMatches ? pageMatches.length : 1;

  // Extract text between BT (begin text) and ET (end text) operators
  const textBlocks: string[] = [];
  const btEtRegex = /BT\s([\s\S]*?)ET/g;
  let match: RegExpExecArray | null;

  while ((match = btEtRegex.exec(raw)) !== null) {
    const block = match[1]!;
    // Extract text from Tj and TJ operators
    const tjMatches = block.match(/\(([^)]*)\)\s*Tj/g);
    if (tjMatches) {
      for (const tj of tjMatches) {
        const textMatch = tj.match(/\(([^)]*)\)/);
        if (textMatch) {
          textBlocks.push(decodeEscapedPdfText(textMatch[1]!));
        }
      }
    }

    // TJ operator — array of strings
    const tjArrayMatches = block.match(/\[([^\]]*)\]\s*TJ/gi);
    if (tjArrayMatches) {
      for (const tjArr of tjArrayMatches) {
        const stringsInArray = tjArr.match(/\(([^)]*)\)/g);
        if (stringsInArray) {
          const parts = stringsInArray.map((s) => decodeEscapedPdfText(s.slice(1, -1)));
          textBlocks.push(parts.join(''));
        }
      }
    }
  }

  // Also try extracting stream content
  const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
  let streamMatch: RegExpExecArray | null;
  while ((streamMatch = streamRegex.exec(raw)) !== null) {
    const streamContent = streamMatch[1]!;
    // Look for readable ASCII text sequences
    const readableChunks = streamContent.match(/[\x20-\x7E]{4,}/g);
    if (readableChunks) {
      for (const chunk of readableChunks) {
        if (!chunk.includes('/') && !chunk.includes('<<') && chunk.length > 8) {
          textBlocks.push(chunk);
        }
      }
    }
  }

  // Extract info from PDF metadata
  const info: Record<string, unknown> = {};
  const titleMatch = raw.match(/\/Title\s*\(([^)]*)\)/);
  if (titleMatch) info['title'] = titleMatch[1];
  const authorMatch = raw.match(/\/Author\s*\(([^)]*)\)/);
  if (authorMatch) info['author'] = authorMatch[1];

  const text = textBlocks.join(' ').replace(/\s+/g, ' ').trim();

  return { text: text || '[No extractable text found — PDF may be image-based]', numpages, info };
}

function decodeEscapedPdfText(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
    .replace(/\\([()])/g, '$1');
}

// ---------------------------------------------------------------------------
// Table extraction
// ---------------------------------------------------------------------------

/**
 * Extract tables from PDF text using heuristic line/column detection.
 * Looks for consistent whitespace-delimited columnar data.
 */
function extractTables(text: string): Table[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const tables: Table[] = [];
  let currentTableRows: string[][] = [];
  let currentPageEstimate = 1;
  let consecutiveTabular = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Estimate page breaks
    if (line.match(/^\f/) || line.match(/^page\s+\d+/i)) {
      currentPageEstimate++;
    }

    // Detect tabular lines: multiple whitespace-separated columns or pipe/tab delimiters
    const columns = splitTableLine(line);

    if (columns.length >= 2) {
      currentTableRows.push(columns);
      consecutiveTabular++;
    } else {
      if (consecutiveTabular >= 3 && currentTableRows.length >= 3) {
        // We found a table
        const headers = isHeaderRow(currentTableRows[0]!) ? currentTableRows[0]! : null;
        tables.push({
          pageNumber: currentPageEstimate,
          rows: headers ? currentTableRows.slice(1) : currentTableRows,
          headers,
        });
      }
      currentTableRows = [];
      consecutiveTabular = 0;
    }
  }

  // Flush remaining
  if (consecutiveTabular >= 3 && currentTableRows.length >= 3) {
    const headers = isHeaderRow(currentTableRows[0]!) ? currentTableRows[0]! : null;
    tables.push({
      pageNumber: currentPageEstimate,
      rows: headers ? currentTableRows.slice(1) : currentTableRows,
      headers,
    });
  }

  return tables;
}

function splitTableLine(line: string): string[] {
  // Try pipe delimiter first
  if (line.includes('|')) {
    return line.split('|').map((c) => c.trim()).filter(Boolean);
  }
  // Try tab delimiter
  if (line.includes('\t')) {
    return line.split('\t').map((c) => c.trim()).filter(Boolean);
  }
  // Try multiple-space delimiter (2+ spaces between columns)
  const parts = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
  if (parts.length >= 2) return parts;

  return [line];
}

function isHeaderRow(row: string[]): boolean {
  // Heuristic: headers are typically non-numeric, short, and may contain uppercase
  const numericCount = row.filter((cell) => /^\d+([.,]\d+)?$/.test(cell)).length;
  return numericCount < row.length / 2;
}

// ---------------------------------------------------------------------------
// Search implementation
// ---------------------------------------------------------------------------

function searchPdf(text: string, query: string): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const pages = text.split(/\f/);

  // Search each page
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageText = pages[pageIdx]!;
    const lowerPageText = pageText.toLowerCase();
    let searchFrom = 0;

    while (true) {
      const pos = lowerPageText.indexOf(lowerQuery, searchFrom);
      if (pos === -1) break;

      // Extract context (100 chars before and after)
      const contextStart = Math.max(0, pos - 100);
      const contextEnd = Math.min(pageText.length, pos + query.length + 100);
      const context = pageText.slice(contextStart, contextEnd).replace(/\s+/g, ' ').trim();

      matches.push({
        text: pageText.slice(pos, pos + query.length),
        pageEstimate: pageIdx + 1,
        context: `...${context}...`,
        position: pos,
      });

      searchFrom = pos + 1;
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

function resolvePath(path: string): string {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  return resolved;
}

async function pdfExtractText(path: string): Promise<ExtractedText> {
  const filePath = resolvePath(path);
  const buffer = readFileSync(filePath);
  const result = await parsePdf(buffer);

  return {
    text: result.text,
    pages: result.numpages,
    info: result.info as PDFInfo,
    method: result.info['_method'] === 'raw' ? 'raw-extraction' : 'pdf-parse',
  };
}

async function pdfExtractTables(path: string): Promise<{ tables: Table[] }> {
  const filePath = resolvePath(path);
  const buffer = readFileSync(filePath);
  const result = await parsePdf(buffer);
  const tables = extractTables(result.text);
  return { tables };
}

async function pdfSearch(path: string, query: string): Promise<{ matches: SearchMatch[]; total: number }> {
  const filePath = resolvePath(path);
  const buffer = readFileSync(filePath);
  const result = await parsePdf(buffer);
  const matches = searchPdf(result.text, query);
  return { matches, total: matches.length };
}

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

export const name = 'pdf-extract';
export const description = 'Extract text, tables, and searchable content from PDF files';
export const version = '3.0.0';

export const tools: ToolDefinition[] = [
  {
    name: 'pdf_extract_text',
    description: 'Extract all text content from a PDF file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the PDF file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'pdf_extract_tables',
    description: 'Extract tabular data from a PDF file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the PDF file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'pdf_search',
    description: 'Search PDF content for a query string',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the PDF file' },
        query: { type: 'string', description: 'Text to search for' },
      },
      required: ['path', 'query'],
    },
  },
];

export async function execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    case 'pdf_extract_text':
      return pdfExtractText(args.path as string);
    case 'pdf_extract_tables':
      return pdfExtractTables(args.path as string);
    case 'pdf_search':
      return pdfSearch(args.path as string, args.query as string);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
