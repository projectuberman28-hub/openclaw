/**
 * @alfred/skill-recipe-scaler - Fallback strategies
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
      name: 'unmodified-ingredient-passthrough',
      description: 'Return ingredient unmodified with warning when parsing fails',
      trigger: 'Ingredient amount cannot be parsed as number',
      action: () => {
        // Keep original ingredient and add warning note
      },
    },
    {
      name: 'unrecognized-unit-passthrough',
      description: 'Pass through unrecognized units without conversion',
      trigger: 'Unit not found in conversion tables',
      action: () => {
        // Built into convertUnit — returns original amount and unit
      },
    },
    {
      name: 'fraction-handling',
      description: 'Parse common fractions (1/2, 1/3, 3/4) in ingredient amounts',
      trigger: 'Amount contains fraction notation',
      action: () => {
        // Built into parseFraction — handles mixed numbers and fractions
      },
    },
    {
      name: 'dietary-rule-fallback',
      description: 'Report unknown dietary filter names with available options',
      trigger: 'Dietary filter name not recognized',
      action: () => {
        // Built into recipeFilter — adds tip with available filter names
      },
    },
  ];
}
