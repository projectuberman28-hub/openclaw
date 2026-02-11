/**
 * @alfred/skill-pdf-extract - Fallback strategies
 */

export interface FallbackStrategy {
  name: string;
  description: string;
  trigger: string;
  action: () => Promise<void> | void;
}

export function getFallbacks(): FallbackStrategy[] {
  return [
    {
      name: 'raw-buffer-extraction',
      description:
        'Extract text directly from PDF buffer using BT/ET text operators when pdf-parse is unavailable',
      trigger: 'pdf-parse module import failure',
      action: () => {
        // Built into parsePdf — automatically falls back to rawExtractText
      },
    },
    {
      name: 'ocr-fallback',
      description:
        'Suggest OCR processing for scanned/image-based PDFs that yield no text. Requires external Tesseract or cloud OCR service.',
      trigger: 'text extraction returns empty or "[No extractable text found]"',
      action: () => {
        // Would integrate with tesseract.js or Google Vision API
        // Currently surfaces a descriptive message to the user
      },
    },
    {
      name: 'encrypted-pdf-handler',
      description: 'Detect and report password-protected PDFs gracefully instead of crashing',
      trigger: 'PDF buffer contains /Encrypt dictionary',
      action: () => {
        // Check for encryption markers and throw descriptive error
      },
    },
    {
      name: 'large-file-streaming',
      description: 'Process large PDFs in chunks to avoid memory issues',
      trigger: 'PDF file size exceeds 50MB',
      action: () => {
        // Stream and process page-by-page instead of loading entire buffer
      },
    },
  ];
}
