# PDF Extract
## Description
Extract text, tables, and searchable content from PDF files. Uses pdf-parse for text extraction with OCR fallback for scanned documents.

## Tools
- `pdf_extract_text(path: string)` — Extract all text from a PDF. Returns `{ text: string, pages: number, info: object }`.
- `pdf_extract_tables(path: string)` — Extract tabular data from a PDF. Returns `{ tables: Table[] }`.
- `pdf_search(path: string, query: string)` — Search PDF content for a query. Returns `{ matches: Match[] }`.

## Dependencies
- pdf-parse (dynamic import for optional dependency)
- Node.js fs for file reading

## Fallbacks
- If pdf-parse is unavailable, attempt raw text extraction from PDF buffer
- OCR fallback mention for scanned/image-based PDFs
- Graceful handling of encrypted/password-protected PDFs
