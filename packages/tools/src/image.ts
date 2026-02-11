/**
 * @alfred/tools - ImageTool
 *
 * Image analysis and audio transcription:
 *   - Analyse images using a vision model
 *   - Recognise .caf audio files for transcription
 *   - Support for common image formats (png, jpg, gif, webp, bmp)
 *   - Uses configurable vision model from config
 */

import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import pino from 'pino';
import { SafeExecutor, type ExecuteOptions } from './safe-executor.js';

const logger = pino({ name: 'alfred:tools:image' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImageAnalyseArgs {
  /** Path to the image or audio file. */
  path: string;
  /** Optional prompt describing what to look for. */
  prompt?: string;
}

export interface ImageAnalyseResult {
  description: string;
  /** 'image' or 'audio' depending on file type. */
  type: 'image' | 'audio';
}

export interface ImageToolConfig {
  /** Vision model identifier (e.g. "anthropic/claude-sonnet-4-20250514"). */
  visionModel?: string;
  /** API base URL for the vision model. */
  apiBaseUrl?: string;
  /** API key for the vision model. */
  apiKey?: string;
}

/**
 * Interface for a vision model backend that can analyse images.
 */
export interface VisionBackend {
  analyse(imageBase64: string, mimeType: string, prompt: string): Promise<string>;
}

/**
 * Interface for an audio transcription backend.
 */
export interface TranscriptionBackend {
  transcribe(audioBase64: string, format: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.svg']);
const AUDIO_EXTENSIONS = new Set(['.caf', '.wav', '.mp3', '.m4a', '.ogg', '.flac', '.aac']);

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
  '.caf': 'audio/x-caf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
};

// ---------------------------------------------------------------------------
// ImageTool
// ---------------------------------------------------------------------------

export class ImageTool {
  private executor: SafeExecutor;
  private config: ImageToolConfig;
  private visionBackend: VisionBackend | null;
  private transcriptionBackend: TranscriptionBackend | null;

  constructor(
    executor: SafeExecutor,
    config: ImageToolConfig = {},
    backends?: {
      vision?: VisionBackend;
      transcription?: TranscriptionBackend;
    },
  ) {
    this.executor = executor;
    this.config = config;
    this.visionBackend = backends?.vision ?? null;
    this.transcriptionBackend = backends?.transcription ?? null;
  }

  static definition = {
    name: 'image',
    description:
      'Analyse an image file or transcribe a .caf audio file. ' +
      'Provide a path and optional prompt for guidance.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to image or audio file' },
        prompt: {
          type: 'string',
          description: 'What to look for / describe (optional)',
        },
      },
      required: ['path'],
    },
  };

  /**
   * Set the vision backend.
   */
  setVisionBackend(backend: VisionBackend): void {
    this.visionBackend = backend;
  }

  /**
   * Set the transcription backend.
   */
  setTranscriptionBackend(backend: TranscriptionBackend): void {
    this.transcriptionBackend = backend;
  }

  /**
   * Analyse an image or transcribe audio.
   */
  async analyze(args: ImageAnalyseArgs, execOpts?: ExecuteOptions): Promise<ImageAnalyseResult> {
    if (!args.path || typeof args.path !== 'string') {
      throw new Error('ImageTool: "path" is required');
    }

    const ext = extname(args.path).toLowerCase();

    // Determine file type
    const isImage = IMAGE_EXTENSIONS.has(ext);
    const isAudio = AUDIO_EXTENSIONS.has(ext);

    if (!isImage && !isAudio) {
      throw new Error(
        `ImageTool: unsupported file type "${ext}". ` +
          `Supported: ${[...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS].join(', ')}`,
      );
    }

    const result = await this.executor.execute(
      'image.analyze',
      async () => {
        // Verify file exists and is readable
        const fileInfo = await stat(args.path);
        if (!fileInfo.isFile()) {
          throw new Error(`ImageTool: "${args.path}" is not a file`);
        }

        // Enforce reasonable size limit (50 MB)
        if (fileInfo.size > 50 * 1024 * 1024) {
          throw new Error('ImageTool: file exceeds 50 MB limit');
        }

        const fileData = await readFile(args.path);
        const base64 = fileData.toString('base64');
        const mimeType = MIME_MAP[ext] ?? 'application/octet-stream';

        if (isAudio) {
          return this.handleAudio(base64, ext, args.prompt);
        }

        return this.handleImage(base64, mimeType, args.prompt);
      },
      { timeout: 60_000, ...execOpts },
    );

    if (result.error) {
      throw new Error(result.error);
    }

    return result.result as ImageAnalyseResult;
  }

  // -----------------------------------------------------------------------
  // Image handling
  // -----------------------------------------------------------------------

  private async handleImage(
    base64: string,
    mimeType: string,
    prompt?: string,
  ): Promise<ImageAnalyseResult> {
    const effectivePrompt = prompt ?? 'Describe this image in detail.';

    if (this.visionBackend) {
      const description = await this.visionBackend.analyse(base64, mimeType, effectivePrompt);
      return { description, type: 'image' };
    }

    // Fallback: try to call a vision API directly
    if (this.config.apiKey && this.config.apiBaseUrl) {
      const description = await this.callVisionApi(base64, mimeType, effectivePrompt);
      return { description, type: 'image' };
    }

    return {
      description:
        `[Image loaded: ${Math.round(base64.length * 0.75 / 1024)} KB, ${mimeType}] ` +
        'No vision backend configured. Set a vision model to enable image analysis.',
      type: 'image',
    };
  }

  // -----------------------------------------------------------------------
  // Audio handling (.caf and others)
  // -----------------------------------------------------------------------

  private async handleAudio(
    base64: string,
    ext: string,
    prompt?: string,
  ): Promise<ImageAnalyseResult> {
    if (this.transcriptionBackend) {
      const transcription = await this.transcriptionBackend.transcribe(base64, ext.slice(1));
      return { description: transcription, type: 'audio' };
    }

    return {
      description:
        `[Audio loaded: ${Math.round(base64.length * 0.75 / 1024)} KB, format: ${ext}] ` +
        'No transcription backend configured.',
      type: 'audio',
    };
  }

  // -----------------------------------------------------------------------
  // Direct vision API call (fallback when no backend injected)
  // -----------------------------------------------------------------------

  private async callVisionApi(
    base64: string,
    mimeType: string,
    prompt: string,
  ): Promise<string> {
    const model = this.config.visionModel ?? 'anthropic/claude-sonnet-4-20250514';
    const baseUrl = this.config.apiBaseUrl!;

    const body = {
      model,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: base64,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    };

    const resp = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(55_000),
    });

    if (!resp.ok) {
      throw new Error(`Vision API responded with ${resp.status}`);
    }

    const data = (await resp.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    const textBlock = data.content?.find((b) => b.type === 'text');
    return textBlock?.text ?? 'No description generated';
  }
}
