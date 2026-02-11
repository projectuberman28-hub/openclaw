/**
 * @alfred/skill-recipe-scaler
 *
 * Scale recipes, generate shopping lists, convert units,
 * and filter by dietary requirements.
 */

import type { ToolDefinition } from '@alfred/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Ingredient {
  name: string;
  amount: number;
  unit: string;
  notes?: string;
}

interface Recipe {
  name: string;
  servings: number;
  ingredients: Ingredient[];
  instructions?: string[];
}

interface ShoppingItem {
  name: string;
  totalAmount: number;
  unit: string;
  fromRecipes: string[];
}

interface DietaryFlag {
  ingredient: string;
  flags: string[];
  alternatives: string[];
}

// ---------------------------------------------------------------------------
// Unit conversion tables
// ---------------------------------------------------------------------------

const METRIC_TO_IMPERIAL: Record<string, { unit: string; factor: number }> = {
  g: { unit: 'oz', factor: 0.03527396 },
  grams: { unit: 'oz', factor: 0.03527396 },
  kg: { unit: 'lbs', factor: 2.20462 },
  kilograms: { unit: 'lbs', factor: 2.20462 },
  ml: { unit: 'fl oz', factor: 0.033814 },
  milliliters: { unit: 'fl oz', factor: 0.033814 },
  l: { unit: 'cups', factor: 4.22675 },
  liters: { unit: 'cups', factor: 4.22675 },
  cm: { unit: 'inches', factor: 0.393701 },
  celsius: { unit: 'fahrenheit', factor: 0 }, // special handling
};

const IMPERIAL_TO_METRIC: Record<string, { unit: string; factor: number }> = {
  oz: { unit: 'g', factor: 28.3495 },
  ounces: { unit: 'g', factor: 28.3495 },
  lbs: { unit: 'kg', factor: 0.453592 },
  lb: { unit: 'kg', factor: 0.453592 },
  pounds: { unit: 'kg', factor: 0.453592 },
  cups: { unit: 'ml', factor: 236.588 },
  cup: { unit: 'ml', factor: 236.588 },
  tbsp: { unit: 'ml', factor: 14.7868 },
  tablespoon: { unit: 'ml', factor: 14.7868 },
  tablespoons: { unit: 'ml', factor: 14.7868 },
  tsp: { unit: 'ml', factor: 4.92892 },
  teaspoon: { unit: 'ml', factor: 4.92892 },
  teaspoons: { unit: 'ml', factor: 4.92892 },
  'fl oz': { unit: 'ml', factor: 29.5735 },
  quart: { unit: 'l', factor: 0.946353 },
  quarts: { unit: 'l', factor: 0.946353 },
  gallon: { unit: 'l', factor: 3.78541 },
  gallons: { unit: 'l', factor: 3.78541 },
  pint: { unit: 'ml', factor: 473.176 },
  pints: { unit: 'ml', factor: 473.176 },
  inches: { unit: 'cm', factor: 2.54 },
  inch: { unit: 'cm', factor: 2.54 },
  fahrenheit: { unit: 'celsius', factor: 0 }, // special handling
};

// Units that don't need conversion
const UNITLESS = new Set([
  '', 'pinch', 'pinches', 'dash', 'dashes', 'piece', 'pieces',
  'clove', 'cloves', 'bunch', 'bunches', 'whole', 'slice', 'slices',
  'sprig', 'sprigs', 'leaf', 'leaves', 'head', 'heads', 'stalk', 'stalks',
  'can', 'cans', 'bottle', 'bottles', 'package', 'packages', 'each',
]);

function convertUnit(
  amount: number,
  unit: string,
  targetSystem: 'metric' | 'imperial',
): { amount: number; unit: string } {
  const lowerUnit = unit.toLowerCase().trim();

  if (UNITLESS.has(lowerUnit)) {
    return { amount, unit };
  }

  // Temperature special case
  if (lowerUnit === 'celsius' && targetSystem === 'imperial') {
    return { amount: Math.round(amount * 9 / 5 + 32), unit: 'fahrenheit' };
  }
  if (lowerUnit === 'fahrenheit' && targetSystem === 'metric') {
    return { amount: Math.round((amount - 32) * 5 / 9), unit: 'celsius' };
  }

  const conversionTable =
    targetSystem === 'metric' ? IMPERIAL_TO_METRIC : METRIC_TO_IMPERIAL;

  const conversion = conversionTable[lowerUnit];
  if (!conversion) {
    return { amount, unit }; // Pass through unrecognized units
  }

  const converted = amount * conversion.factor;
  return {
    amount: Math.round(converted * 100) / 100,
    unit: conversion.unit,
  };
}

// ---------------------------------------------------------------------------
// Fraction handling
// ---------------------------------------------------------------------------

function parseFraction(text: string): number {
  // Handle mixed numbers: "1 1/2"
  const mixedMatch = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedMatch) {
    return parseInt(mixedMatch[1]!) + parseInt(mixedMatch[2]!) / parseInt(mixedMatch[3]!);
  }

  // Handle fractions: "1/2"
  const fractionMatch = text.match(/^(\d+)\/(\d+)$/);
  if (fractionMatch) {
    return parseInt(fractionMatch[1]!) / parseInt(fractionMatch[2]!);
  }

  // Handle decimals
  return parseFloat(text) || 0;
}

function formatAmount(amount: number): string {
  // Convert back to friendly fractions when appropriate
  const fractions: Array<[number, string]> = [
    [0.25, '1/4'],
    [0.333, '1/3'],
    [0.5, '1/2'],
    [0.667, '2/3'],
    [0.75, '3/4'],
  ];

  const whole = Math.floor(amount);
  const frac = amount - whole;

  if (frac < 0.05) {
    return whole.toString();
  }

  for (const [threshold, display] of fractions) {
    if (Math.abs(frac - threshold) < 0.05) {
      return whole > 0 ? `${whole} ${display}` : display;
    }
  }

  return amount.toFixed(2).replace(/\.?0+$/, '');
}

// ---------------------------------------------------------------------------
// Dietary filters
// ---------------------------------------------------------------------------

interface DietaryRule {
  name: string;
  flaggedIngredients: string[];
  alternatives: Record<string, string[]>;
}

const DIETARY_RULES: DietaryRule[] = [
  {
    name: 'gluten-free',
    flaggedIngredients: [
      'flour', 'all-purpose flour', 'bread flour', 'wheat', 'whole wheat',
      'barley', 'rye', 'couscous', 'orzo', 'pasta', 'noodles', 'spaghetti',
      'bread', 'breadcrumbs', 'panko', 'croutons', 'soy sauce',
      'beer', 'malt', 'seitan',
    ],
    alternatives: {
      'flour': ['almond flour', 'coconut flour', 'rice flour', 'oat flour (certified GF)'],
      'all-purpose flour': ['gluten-free all-purpose flour blend', 'almond flour'],
      'bread flour': ['gluten-free bread flour blend'],
      'breadcrumbs': ['gluten-free breadcrumbs', 'crushed rice crackers', 'almond meal'],
      'panko': ['gluten-free panko', 'crushed corn flakes'],
      'pasta': ['gluten-free pasta', 'rice noodles', 'zucchini noodles'],
      'spaghetti': ['gluten-free spaghetti', 'rice spaghetti', 'spaghetti squash'],
      'noodles': ['rice noodles', 'glass noodles', 'shirataki noodles'],
      'soy sauce': ['tamari (gluten-free)', 'coconut aminos'],
      'couscous': ['quinoa', 'cauliflower rice'],
      'bread': ['gluten-free bread'],
      'beer': ['gluten-free beer', 'hard cider'],
    },
  },
  {
    name: 'dairy-free',
    flaggedIngredients: [
      'milk', 'cream', 'butter', 'cheese', 'yogurt', 'whey',
      'casein', 'ghee', 'sour cream', 'cream cheese', 'half-and-half',
      'heavy cream', 'parmesan', 'mozzarella', 'cheddar',
    ],
    alternatives: {
      'milk': ['almond milk', 'oat milk', 'coconut milk', 'soy milk'],
      'cream': ['coconut cream', 'cashew cream'],
      'butter': ['olive oil', 'coconut oil', 'vegan butter'],
      'cheese': ['nutritional yeast', 'vegan cheese'],
      'yogurt': ['coconut yogurt', 'almond yogurt'],
      'sour cream': ['cashew cream', 'coconut cream'],
      'cream cheese': ['vegan cream cheese', 'cashew cream cheese'],
      'heavy cream': ['full-fat coconut milk', 'cashew cream'],
      'parmesan': ['nutritional yeast', 'vegan parmesan'],
    },
  },
  {
    name: 'vegan',
    flaggedIngredients: [
      'meat', 'chicken', 'beef', 'pork', 'lamb', 'turkey', 'bacon',
      'fish', 'salmon', 'tuna', 'shrimp', 'crab', 'lobster',
      'egg', 'eggs', 'honey', 'gelatin',
      'milk', 'cream', 'butter', 'cheese', 'yogurt', 'whey',
    ],
    alternatives: {
      'chicken': ['tofu', 'seitan', 'tempeh', 'jackfruit'],
      'beef': ['beyond meat', 'mushroom', 'lentils'],
      'pork': ['jackfruit', 'tempeh'],
      'eggs': ['flax egg', 'chia egg', 'silken tofu', 'aquafaba'],
      'egg': ['flax egg (1 tbsp ground flax + 3 tbsp water)'],
      'honey': ['maple syrup', 'agave nectar'],
      'gelatin': ['agar-agar'],
      'butter': ['vegan butter', 'coconut oil'],
      'milk': ['oat milk', 'almond milk', 'soy milk'],
    },
  },
  {
    name: 'nut-free',
    flaggedIngredients: [
      'almond', 'almonds', 'almond flour', 'almond milk', 'almond butter',
      'walnut', 'walnuts', 'pecan', 'pecans', 'cashew', 'cashews',
      'pistachio', 'pistachios', 'hazelnut', 'hazelnuts',
      'macadamia', 'peanut', 'peanuts', 'peanut butter',
      'pine nut', 'pine nuts', 'brazil nut', 'brazil nuts',
    ],
    alternatives: {
      'almond flour': ['oat flour', 'sunflower seed flour'],
      'almond milk': ['oat milk', 'rice milk', 'coconut milk'],
      'peanut butter': ['sunflower seed butter', 'tahini'],
      'cashews': ['sunflower seeds', 'hemp seeds'],
      'walnuts': ['sunflower seeds', 'pumpkin seeds'],
      'almonds': ['pumpkin seeds', 'sunflower seeds'],
    },
  },
  {
    name: 'keto',
    flaggedIngredients: [
      'sugar', 'flour', 'bread', 'rice', 'pasta', 'potato', 'potatoes',
      'corn', 'oats', 'oatmeal', 'honey', 'maple syrup', 'agave',
      'banana', 'grapes', 'mango', 'pineapple',
    ],
    alternatives: {
      'sugar': ['erythritol', 'stevia', 'monk fruit sweetener'],
      'flour': ['almond flour', 'coconut flour'],
      'rice': ['cauliflower rice'],
      'pasta': ['zucchini noodles', 'shirataki noodles'],
      'potato': ['cauliflower', 'turnip'],
      'bread': ['cloud bread', 'lettuce wraps'],
      'honey': ['sugar-free syrup'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function recipeScale(
  recipe: Recipe,
  servings: number,
): Promise<{ scaled: Recipe }> {
  if (servings <= 0) {
    throw new Error('Target servings must be positive');
  }
  if (!recipe.ingredients || recipe.ingredients.length === 0) {
    throw new Error('Recipe must have at least one ingredient');
  }

  const factor = servings / recipe.servings;

  const scaledIngredients: Ingredient[] = recipe.ingredients.map((ing) => ({
    name: ing.name,
    amount: Math.round(ing.amount * factor * 1000) / 1000,
    unit: ing.unit,
    notes: ing.notes,
  }));

  return {
    scaled: {
      name: recipe.name,
      servings,
      ingredients: scaledIngredients,
      instructions: recipe.instructions,
    },
  };
}

async function recipeShoppingList(
  recipes: Recipe[],
): Promise<{ list: ShoppingItem[] }> {
  if (!recipes || recipes.length === 0) {
    throw new Error('At least one recipe is required');
  }

  const itemMap = new Map<string, ShoppingItem>();

  for (const recipe of recipes) {
    for (const ing of recipe.ingredients) {
      const key = `${ing.name.toLowerCase()}_${ing.unit.toLowerCase()}`;
      const existing = itemMap.get(key);

      if (existing) {
        existing.totalAmount += ing.amount;
        if (!existing.fromRecipes.includes(recipe.name)) {
          existing.fromRecipes.push(recipe.name);
        }
      } else {
        itemMap.set(key, {
          name: ing.name,
          totalAmount: ing.amount,
          unit: ing.unit,
          fromRecipes: [recipe.name],
        });
      }
    }
  }

  const list = Array.from(itemMap.values())
    .map((item) => ({
      ...item,
      totalAmount: Math.round(item.totalAmount * 100) / 100,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { list };
}

async function recipeConvert(
  recipe: Recipe,
  unitSystem: string,
): Promise<{ converted: Recipe }> {
  const system = unitSystem.toLowerCase() as 'metric' | 'imperial';
  if (system !== 'metric' && system !== 'imperial') {
    throw new Error(`Invalid unit system: ${unitSystem}. Use 'metric' or 'imperial'.`);
  }

  const convertedIngredients: Ingredient[] = recipe.ingredients.map((ing) => {
    const { amount, unit } = convertUnit(ing.amount, ing.unit, system);
    return { name: ing.name, amount, unit, notes: ing.notes };
  });

  return {
    converted: {
      name: recipe.name,
      servings: recipe.servings,
      ingredients: convertedIngredients,
      instructions: recipe.instructions,
    },
  };
}

async function recipeFilter(
  dietary: string[],
): Promise<{ filters: DietaryRule[]; tips: string[] }> {
  if (!dietary || dietary.length === 0) {
    throw new Error('At least one dietary requirement is required');
  }

  const matchedRules: DietaryRule[] = [];
  const tips: string[] = [];

  for (const diet of dietary) {
    const lowerDiet = diet.toLowerCase().replace(/[-_\s]+/g, '-');
    const rule = DIETARY_RULES.find(
      (r) => r.name === lowerDiet || r.name.includes(lowerDiet),
    );

    if (rule) {
      matchedRules.push(rule);
      tips.push(
        `${rule.name}: Watch for ${rule.flaggedIngredients.slice(0, 5).join(', ')} and ${rule.flaggedIngredients.length - 5} more ingredients`,
      );
    } else {
      tips.push(`Unknown dietary filter: "${diet}". Available: ${DIETARY_RULES.map((r) => r.name).join(', ')}`);
    }
  }

  return { filters: matchedRules, tips };
}

// ---------------------------------------------------------------------------
// Skill definition
// ---------------------------------------------------------------------------

export const name = 'recipe-scaler';
export const description =
  'Scale recipes, generate shopping lists, convert units, and filter by dietary requirements';
export const version = '3.0.0';

export const tools: ToolDefinition[] = [
  {
    name: 'recipe_scale',
    description: 'Scale a recipe to a different number of servings',
    parameters: {
      type: 'object',
      properties: {
        recipe: {
          type: 'object',
          description: 'Recipe to scale',
          properties: {
            name: { type: 'string' },
            servings: { type: 'number' },
            ingredients: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  amount: { type: 'number' },
                  unit: { type: 'string' },
                  notes: { type: 'string' },
                },
                required: ['name', 'amount', 'unit'],
              },
            },
            instructions: { type: 'array', items: { type: 'string' } },
          },
          required: ['name', 'servings', 'ingredients'],
        },
        servings: { type: 'number', description: 'Target number of servings' },
      },
      required: ['recipe', 'servings'],
    },
  },
  {
    name: 'recipe_shopping_list',
    description: 'Consolidate ingredients from multiple recipes into a shopping list',
    parameters: {
      type: 'object',
      properties: {
        recipes: {
          type: 'array',
          items: { type: 'object' },
          description: 'Array of Recipe objects',
        },
      },
      required: ['recipes'],
    },
  },
  {
    name: 'recipe_convert',
    description: 'Convert recipe units between metric and imperial',
    parameters: {
      type: 'object',
      properties: {
        recipe: { type: 'object', description: 'Recipe to convert' },
        unit_system: {
          type: 'string',
          enum: ['metric', 'imperial'],
          description: 'Target unit system',
        },
      },
      required: ['recipe', 'unit_system'],
    },
  },
  {
    name: 'recipe_filter',
    description: 'Get dietary filter rules and flagged ingredients',
    parameters: {
      type: 'object',
      properties: {
        dietary: {
          type: 'array',
          items: { type: 'string' },
          description: 'Dietary requirements: gluten-free, dairy-free, vegan, nut-free, keto',
        },
      },
      required: ['dietary'],
    },
  },
];

export async function execute(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    case 'recipe_scale':
      return recipeScale(args.recipe as Recipe, args.servings as number);
    case 'recipe_shopping_list':
      return recipeShoppingList(args.recipes as Recipe[]);
    case 'recipe_convert':
      return recipeConvert(args.recipe as Recipe, args.unit_system as string);
    case 'recipe_filter':
      return recipeFilter(args.dietary as string[]);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
