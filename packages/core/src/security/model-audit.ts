/**
 * @alfred/core - Model Audit
 *
 * Audits model selections and warns about potentially weak or problematic models.
 * Warns on GPT-3.5, small models (<7B parameters), and unknown providers.
 */

// ---------------------------------------------------------------------------
// Known providers
// ---------------------------------------------------------------------------

const KNOWN_PROVIDERS = new Set([
  'anthropic',
  'openai',
  'google',
  'meta',
  'mistral',
  'cohere',
  'ollama',
  'groq',
  'together',
  'deepseek',
  'perplexity',
  'fireworks',
  'anyscale',
  'replicate',
  'huggingface',
  'local',
  'lmstudio',
  'openrouter',
]);

// ---------------------------------------------------------------------------
// Weak model patterns
// ---------------------------------------------------------------------------

interface WeakModelPattern {
  pattern: RegExp;
  warning: string;
  severity: 'low' | 'medium' | 'high';
}

const WEAK_MODEL_PATTERNS: WeakModelPattern[] = [
  {
    pattern: /gpt-3\.5/i,
    warning: 'GPT-3.5 has limited reasoning capabilities. Consider upgrading to GPT-4 or Claude for complex tasks.',
    severity: 'medium',
  },
  {
    pattern: /gpt-4o-mini/i,
    warning: 'GPT-4o-mini is a smaller model with reduced capabilities compared to full GPT-4o.',
    severity: 'low',
  },
  {
    pattern: /text-davinci/i,
    warning: 'text-davinci models are deprecated. Migrate to chat completion models.',
    severity: 'high',
  },
  {
    pattern: /text-ada|text-babbage|text-curie/i,
    warning: 'Legacy completion models have very limited capabilities. Use modern chat models instead.',
    severity: 'high',
  },
];

// ---------------------------------------------------------------------------
// Small model detection
// ---------------------------------------------------------------------------

/**
 * Attempt to extract parameter count from model name.
 * Looks for patterns like "7b", "13b", "70b", "1.5b", etc.
 * Returns the count in billions, or null if not detectable.
 */
function extractParamCount(modelName: string): number | null {
  // Match patterns like "7b", "7B", "1.5b", "70b", "0.5b"
  const match = modelName.match(/(\d+(?:\.\d+)?)\s*[bB](?:\b|[^a-zA-Z]|$)/);
  if (match && match[1]) {
    return parseFloat(match[1]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ModelAuditWarning {
  message: string;
  severity: 'low' | 'medium' | 'high';
  category: 'weak-model' | 'small-model' | 'unknown-provider' | 'deprecated' | 'format';
}

export interface ModelAuditResult {
  modelId: string;
  provider: string;
  modelName: string;
  warnings: ModelAuditWarning[];
  parametersBillions: number | null;
  isKnownProvider: boolean;
  overallRisk: 'none' | 'low' | 'medium' | 'high';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Audit a model identifier for potential issues.
 *
 * @param modelId - Model in "provider/model" format
 * @returns Audit result with warnings
 */
export function auditModel(modelId: string): ModelAuditResult {
  const warnings: ModelAuditWarning[] = [];

  // Parse provider/model format
  const slashIndex = modelId.indexOf('/');
  let provider: string;
  let modelName: string;

  if (slashIndex === -1) {
    provider = 'unknown';
    modelName = modelId;
    warnings.push({
      message: `Model "${modelId}" is not in provider/model format. Expected format: provider/model-name`,
      severity: 'low',
      category: 'format',
    });
  } else {
    provider = modelId.slice(0, slashIndex).toLowerCase();
    modelName = modelId.slice(slashIndex + 1);
  }

  const isKnownProvider = KNOWN_PROVIDERS.has(provider);

  // Check for unknown provider
  if (!isKnownProvider && provider !== 'unknown') {
    warnings.push({
      message: `Unknown provider "${provider}". Ensure this provider is configured correctly and supports the expected API format.`,
      severity: 'medium',
      category: 'unknown-provider',
    });
  }

  // Check against weak model patterns
  for (const pattern of WEAK_MODEL_PATTERNS) {
    if (pattern.pattern.test(modelName) || pattern.pattern.test(modelId)) {
      warnings.push({
        message: pattern.warning,
        severity: pattern.severity,
        category: modelName.includes('davinci') || modelName.includes('ada') || modelName.includes('babbage') || modelName.includes('curie')
          ? 'deprecated'
          : 'weak-model',
      });
    }
  }

  // Check for small parameter count
  const paramCount = extractParamCount(modelName);
  if (paramCount !== null && paramCount < 7) {
    warnings.push({
      message: `Model appears to have ${paramCount}B parameters. Models smaller than 7B may produce lower quality outputs for complex tasks.`,
      severity: paramCount < 3 ? 'high' : 'medium',
      category: 'small-model',
    });
  }

  // Determine overall risk
  let overallRisk: ModelAuditResult['overallRisk'] = 'none';
  for (const w of warnings) {
    if (w.severity === 'high') {
      overallRisk = 'high';
      break;
    }
    if (w.severity === 'medium') {
      overallRisk = 'medium';
    }
    if (w.severity === 'low' && overallRisk === 'none') {
      overallRisk = 'low';
    }
  }

  return {
    modelId,
    provider,
    modelName,
    warnings,
    parametersBillions: paramCount,
    isKnownProvider,
    overallRisk,
  };
}

/**
 * Quick check: does a model have any high-severity warnings?
 */
export function hasHighRiskWarnings(modelId: string): boolean {
  const result = auditModel(modelId);
  return result.warnings.some((w) => w.severity === 'high');
}

/**
 * Get a list of all known providers.
 */
export function getKnownProviders(): string[] {
  return [...KNOWN_PROVIDERS].sort();
}
