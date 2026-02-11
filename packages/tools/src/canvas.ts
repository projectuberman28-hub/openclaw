/**
 * @alfred/tools - CanvasTool
 *
 * Render UI components as HTML for display in the Alfred UI.
 * Supported types:
 *   - table:    tabular data
 *   - chart:    simple chart (bar, line, pie)
 *   - form:     input form
 *   - markdown: rendered markdown
 *   - code:     syntax-highlighted code block
 */

import pino from 'pino';
import { SafeExecutor, type ExecuteOptions } from './safe-executor.js';

const logger = pino({ name: 'alfred:tools:canvas' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CanvasRenderArgs {
  /** Component type to render. */
  type: 'table' | 'chart' | 'form' | 'markdown' | 'code';
  /** Data for the component. */
  data: any;
}

export interface CanvasRenderResult {
  html: string;
}

// ---------------------------------------------------------------------------
// Escape helpers
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------------------------------------------------------------------------
// CanvasTool
// ---------------------------------------------------------------------------

export class CanvasTool {
  private executor: SafeExecutor;

  constructor(executor: SafeExecutor) {
    this.executor = executor;
  }

  static definition = {
    name: 'canvas',
    description:
      'Render a UI component (table, chart, form, markdown, code) as HTML.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['table', 'chart', 'form', 'markdown', 'code'],
          description: 'Component type',
        },
        data: {
          type: 'object',
          description: 'Component data',
        },
      },
      required: ['type', 'data'],
    },
  };

  /**
   * Render a UI component to HTML.
   */
  async render(args: CanvasRenderArgs, execOpts?: ExecuteOptions): Promise<CanvasRenderResult> {
    if (!args.type || typeof args.type !== 'string') {
      throw new Error('CanvasTool: "type" is required');
    }
    if (args.data === undefined || args.data === null) {
      throw new Error('CanvasTool: "data" is required');
    }

    const result = await this.executor.execute(
      'canvas.render',
      async () => {
        switch (args.type) {
          case 'table':
            return { html: this.renderTable(args.data) };
          case 'chart':
            return { html: this.renderChart(args.data) };
          case 'form':
            return { html: this.renderForm(args.data) };
          case 'markdown':
            return { html: this.renderMarkdown(args.data) };
          case 'code':
            return { html: this.renderCode(args.data) };
          default:
            throw new Error(`CanvasTool: unsupported type "${args.type}"`);
        }
      },
      { timeout: 10_000, ...execOpts },
    );

    if (result.error) {
      throw new Error(result.error);
    }

    return result.result as CanvasRenderResult;
  }

  // -----------------------------------------------------------------------
  // Renderers
  // -----------------------------------------------------------------------

  /**
   * Render a table.
   * data: { headers: string[], rows: any[][] } or array of objects
   */
  private renderTable(data: any): string {
    let headers: string[];
    let rows: any[][];

    if (data.headers && data.rows) {
      headers = data.headers;
      rows = data.rows;
    } else if (Array.isArray(data)) {
      if (data.length === 0) return '<table><tbody><tr><td>No data</td></tr></tbody></table>';
      headers = Object.keys(data[0]);
      rows = data.map((row: any) => headers.map((h) => row[h]));
    } else {
      throw new Error('CanvasTool: table data must have { headers, rows } or be an array of objects');
    }

    const headerHtml = headers.map((h) => `<th>${escapeHtml(String(h))}</th>`).join('');
    const bodyHtml = rows
      .map(
        (row) =>
          '<tr>' +
          row.map((cell: any) => `<td>${escapeHtml(String(cell ?? ''))}</td>`).join('') +
          '</tr>',
      )
      .join('\n');

    return `<table class="alfred-table">
<thead><tr>${headerHtml}</tr></thead>
<tbody>
${bodyHtml}
</tbody>
</table>`;
  }

  /**
   * Render a chart (SVG-based bar/line/pie).
   * data: { type: 'bar'|'line'|'pie', labels: string[], values: number[], title?: string }
   */
  private renderChart(data: any): string {
    const chartType = data.type ?? 'bar';
    const labels: string[] = data.labels ?? [];
    const values: number[] = data.values ?? [];
    const title = data.title ?? '';

    if (labels.length === 0 || values.length === 0) {
      return '<div class="alfred-chart">No chart data provided</div>';
    }

    const maxVal = Math.max(...values, 1);
    const width = 600;
    const height = 400;
    const padding = 60;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" class="alfred-chart">`;

    if (title) {
      svg += `<text x="${width / 2}" y="25" text-anchor="middle" font-size="16" font-weight="bold">${escapeHtml(title)}</text>`;
    }

    if (chartType === 'bar') {
      const barWidth = Math.max(20, (width - padding * 2) / labels.length - 10);

      for (let i = 0; i < labels.length; i++) {
        const x = padding + i * (barWidth + 10);
        const barHeight = ((values[i] ?? 0) / maxVal) * (height - padding * 2);
        const y = height - padding - barHeight;

        svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="#4A90D9" rx="2"/>`;
        svg += `<text x="${x + barWidth / 2}" y="${height - padding + 15}" text-anchor="middle" font-size="11">${escapeHtml(labels[i])}</text>`;
        svg += `<text x="${x + barWidth / 2}" y="${y - 5}" text-anchor="middle" font-size="10">${values[i]}</text>`;
      }
    } else if (chartType === 'line') {
      const stepX = (width - padding * 2) / Math.max(labels.length - 1, 1);
      const points: string[] = [];

      for (let i = 0; i < labels.length; i++) {
        const x = padding + i * stepX;
        const y = height - padding - ((values[i] ?? 0) / maxVal) * (height - padding * 2);
        points.push(`${x},${y}`);

        svg += `<circle cx="${x}" cy="${y}" r="4" fill="#4A90D9"/>`;
        svg += `<text x="${x}" y="${height - padding + 15}" text-anchor="middle" font-size="11">${escapeHtml(labels[i])}</text>`;
      }

      svg += `<polyline points="${points.join(' ')}" fill="none" stroke="#4A90D9" stroke-width="2"/>`;
    } else if (chartType === 'pie') {
      const total = values.reduce((a, b) => a + b, 0) || 1;
      const cx = width / 2;
      const cy = height / 2;
      const r = Math.min(width, height) / 2 - padding;
      const colors = ['#4A90D9', '#D94A4A', '#4AD97A', '#D9C74A', '#9B4AD9', '#4AD9D9', '#D97A4A', '#7A4AD9'];
      let startAngle = 0;

      for (let i = 0; i < values.length; i++) {
        const slice = ((values[i] ?? 0) / total) * 2 * Math.PI;
        const endAngle = startAngle + slice;
        const largeArc = slice > Math.PI ? 1 : 0;

        const x1 = cx + r * Math.cos(startAngle);
        const y1 = cy + r * Math.sin(startAngle);
        const x2 = cx + r * Math.cos(endAngle);
        const y2 = cy + r * Math.sin(endAngle);

        svg += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z" fill="${colors[i % colors.length]}"/>`;

        // Label
        const midAngle = startAngle + slice / 2;
        const lx = cx + (r * 0.7) * Math.cos(midAngle);
        const ly = cy + (r * 0.7) * Math.sin(midAngle);
        svg += `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="10" fill="white">${escapeHtml(labels[i] ?? '')}</text>`;

        startAngle = endAngle;
      }
    }

    svg += '</svg>';
    return svg;
  }

  /**
   * Render a form.
   * data: { fields: Array<{ name, type, label, required?, options?, value? }>, action?: string }
   */
  private renderForm(data: any): string {
    const fields = data.fields ?? [];
    const action = data.action ?? '#';

    let html = `<form class="alfred-form" action="${escapeHtml(action)}" method="post">`;

    for (const field of fields) {
      const name = field.name ?? '';
      const type = field.type ?? 'text';
      const label = field.label ?? name;
      const required = field.required ? 'required' : '';
      const value = field.value ?? '';

      html += `<div class="alfred-form-field">`;
      html += `<label for="${escapeHtml(name)}">${escapeHtml(label)}</label>`;

      if (type === 'select' && Array.isArray(field.options)) {
        html += `<select name="${escapeHtml(name)}" id="${escapeHtml(name)}" ${required}>`;
        for (const opt of field.options) {
          const optVal = typeof opt === 'string' ? opt : opt.value ?? '';
          const optLabel = typeof opt === 'string' ? opt : opt.label ?? optVal;
          const selected = optVal === value ? 'selected' : '';
          html += `<option value="${escapeHtml(optVal)}" ${selected}>${escapeHtml(optLabel)}</option>`;
        }
        html += `</select>`;
      } else if (type === 'textarea') {
        html += `<textarea name="${escapeHtml(name)}" id="${escapeHtml(name)}" ${required}>${escapeHtml(value)}</textarea>`;
      } else {
        html += `<input type="${escapeHtml(type)}" name="${escapeHtml(name)}" id="${escapeHtml(name)}" value="${escapeHtml(value)}" ${required}/>`;
      }

      html += `</div>`;
    }

    html += `<button type="submit">Submit</button>`;
    html += `</form>`;

    return html;
  }

  /**
   * Render markdown to HTML.
   * data: { content: string } or string
   */
  private renderMarkdown(data: any): string {
    const content = typeof data === 'string' ? data : data.content ?? '';

    // Basic markdown-to-HTML conversion
    let html = escapeHtml(content);

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold and italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Lists
    html = html.replace(/^\- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
    // Clean up nested ul tags
    html = html.replace(/<\/ul>\s*<ul>/g, '');

    // Line breaks to paragraphs
    html = html.replace(/\n\n/g, '</p><p>');
    html = `<div class="alfred-markdown"><p>${html}</p></div>`;

    return html;
  }

  /**
   * Render a code block.
   * data: { code: string, language?: string } or string
   */
  private renderCode(data: any): string {
    const code = typeof data === 'string' ? data : data.code ?? '';
    const language = typeof data === 'object' ? data.language ?? '' : '';

    return `<pre class="alfred-code"><code class="language-${escapeHtml(language)}">${escapeHtml(code)}</code></pre>`;
  }
}
