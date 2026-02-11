/**
 * @alfred/tools - BrowserTool
 *
 * Playwright-based browser automation with:
 *   - Lazy loading of playwright (graceful error if not installed)
 *   - navigate, screenshot, click, type, getText operations
 *   - Automatic page lifecycle management
 *   - SafeExecutor integration
 */

import pino from 'pino';
import { SafeExecutor, type ExecuteOptions } from './safe-executor.js';

const logger = pino({ name: 'alfred:tools:browser' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PageInfo {
  url: string;
  title: string;
  statusCode: number;
}

// ---------------------------------------------------------------------------
// BrowserTool
// ---------------------------------------------------------------------------

export class BrowserTool {
  private executor: SafeExecutor;
  private browser: any = null;
  private page: any = null;
  private playwrightAvailable: boolean | null = null;

  constructor(executor: SafeExecutor) {
    this.executor = executor;
  }

  static definition = {
    name: 'browser',
    description:
      'Automate a headless browser. Actions: navigate, screenshot, click, type, getText.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['navigate', 'screenshot', 'click', 'type', 'getText'],
          description: 'Browser action to perform',
        },
        url: { type: 'string', description: 'URL to navigate to (for navigate action)' },
        selector: { type: 'string', description: 'CSS selector (for click/type/getText)' },
        text: { type: 'string', description: 'Text to type (for type action)' },
      },
      required: ['action'],
    },
  };

  // -----------------------------------------------------------------------
  // Playwright lazy-loading
  // -----------------------------------------------------------------------

  private async ensurePlaywright(): Promise<boolean> {
    if (this.playwrightAvailable === false) return false;
    if (this.browser && this.page) return true;

    try {
      // @ts-expect-error -- optional runtime dependency
      const pw = await import('playwright');
      this.browser = await pw.chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const context = await this.browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      this.page = await context.newPage();
      this.playwrightAvailable = true;
      logger.info('Playwright browser launched');
      return true;
    } catch (err) {
      this.playwrightAvailable = false;
      logger.warn('Playwright not available – install it with: npx playwright install chromium');
      return false;
    }
  }

  private assertReady(): void {
    if (!this.page) {
      throw new Error(
        'Browser not available. Install playwright: npm install playwright && npx playwright install chromium',
      );
    }
  }

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  /**
   * Navigate to a URL.
   */
  async navigate(url: string, execOpts?: ExecuteOptions): Promise<PageInfo> {
    if (!url || typeof url !== 'string') {
      throw new Error('BrowserTool.navigate: "url" is required');
    }

    const result = await this.executor.execute(
      'browser.navigate',
      async () => {
        const ready = await this.ensurePlaywright();
        if (!ready) {
          throw new Error('Playwright is not installed');
        }

        const response = await this.page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 25_000,
        });

        return {
          url: this.page.url(),
          title: await this.page.title(),
          statusCode: response?.status() ?? 0,
        };
      },
      { timeout: 30_000, ...execOpts },
    );

    if (result.error) {
      return { url, title: '', statusCode: 0 };
    }

    return result.result as PageInfo;
  }

  /**
   * Take a screenshot (returns base64-encoded PNG).
   */
  async screenshot(execOpts?: ExecuteOptions): Promise<string> {
    const result = await this.executor.execute(
      'browser.screenshot',
      async () => {
        await this.ensurePlaywright();
        this.assertReady();

        const buffer: Buffer = await this.page.screenshot({
          type: 'png',
          fullPage: false,
        });
        return buffer.toString('base64');
      },
      { timeout: 15_000, ...execOpts },
    );

    if (result.error) {
      throw new Error(result.error);
    }

    return result.result as string;
  }

  /**
   * Click an element by selector.
   */
  async click(selector: string, execOpts?: ExecuteOptions): Promise<void> {
    if (!selector || typeof selector !== 'string') {
      throw new Error('BrowserTool.click: "selector" is required');
    }

    const result = await this.executor.execute(
      'browser.click',
      async () => {
        await this.ensurePlaywright();
        this.assertReady();
        await this.page.click(selector, { timeout: 10_000 });
      },
      { timeout: 15_000, ...execOpts },
    );

    if (result.error) {
      throw new Error(result.error);
    }
  }

  /**
   * Type text into an element.
   */
  async type(selector: string, text: string, execOpts?: ExecuteOptions): Promise<void> {
    if (!selector || typeof selector !== 'string') {
      throw new Error('BrowserTool.type: "selector" is required');
    }
    if (typeof text !== 'string') {
      throw new Error('BrowserTool.type: "text" is required');
    }

    const result = await this.executor.execute(
      'browser.type',
      async () => {
        await this.ensurePlaywright();
        this.assertReady();
        await this.page.fill(selector, text, { timeout: 10_000 });
      },
      { timeout: 15_000, ...execOpts },
    );

    if (result.error) {
      throw new Error(result.error);
    }
  }

  /**
   * Get text content from the page or a specific element.
   */
  async getText(selector?: string, execOpts?: ExecuteOptions): Promise<string> {
    const result = await this.executor.execute(
      'browser.getText',
      async () => {
        await this.ensurePlaywright();
        this.assertReady();

        if (selector) {
          const element = await this.page.$(selector);
          if (!element) {
            throw new Error(`Element not found: ${selector}`);
          }
          return element.textContent();
        }

        // Get full page text
        return this.page.evaluate(() => document.body.innerText);
      },
      { timeout: 15_000, ...execOpts },
    );

    if (result.error) {
      return '';
    }

    return (result.result as string) ?? '';
  }

  /**
   * Close the browser instance.
   */
  async close(): Promise<void> {
    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
    } catch {
      // Best-effort cleanup
    }
  }
}
