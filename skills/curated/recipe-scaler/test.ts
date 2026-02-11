/**
 * @alfred/skill-recipe-scaler - Test cases
 */

export default [
  {
    name: 'recipe_scale doubles ingredients for double servings',
    input: {
      tool: 'recipe_scale',
      args: {
        recipe: {
          name: 'Pancakes',
          servings: 4,
          ingredients: [
            { name: 'flour', amount: 2, unit: 'cups' },
            { name: 'milk', amount: 1.5, unit: 'cups' },
            { name: 'eggs', amount: 2, unit: 'each' },
          ],
        },
        servings: 8,
      },
    },
    expected: {
      scaled: {
        servings: 8,
        ingredients: [
          { name: 'flour', amount: 4, unit: 'cups' },
          { name: 'milk', amount: 3, unit: 'cups' },
          { name: 'eggs', amount: 4, unit: 'each' },
        ],
      },
    },
  },
  {
    name: 'recipe_scale rejects zero servings',
    input: {
      tool: 'recipe_scale',
      args: { recipe: { name: 'Test', servings: 4, ingredients: [] }, servings: 0 },
    },
    expected: { error: 'Target servings must be positive' },
  },
  {
    name: 'recipe_shopping_list consolidates ingredients',
    input: {
      tool: 'recipe_shopping_list',
      args: {
        recipes: [
          { name: 'Recipe A', servings: 4, ingredients: [{ name: 'flour', amount: 2, unit: 'cups' }] },
          { name: 'Recipe B', servings: 4, ingredients: [{ name: 'flour', amount: 1, unit: 'cups' }] },
        ],
      },
    },
    expected: { list: [{ name: 'flour', totalAmount: 3, unit: 'cups' }] },
  },
  {
    name: 'recipe_convert converts cups to ml',
    input: {
      tool: 'recipe_convert',
      args: {
        recipe: {
          name: 'Test',
          servings: 4,
          ingredients: [{ name: 'milk', amount: 2, unit: 'cups' }],
        },
        unit_system: 'metric',
      },
    },
    expected: { converted: { ingredients: [{ unit: 'ml' }] } },
  },
  {
    name: 'recipe_convert converts grams to oz',
    input: {
      tool: 'recipe_convert',
      args: {
        recipe: {
          name: 'Test',
          servings: 4,
          ingredients: [{ name: 'butter', amount: 100, unit: 'g' }],
        },
        unit_system: 'imperial',
      },
    },
    expected: { converted: { ingredients: [{ unit: 'oz' }] } },
  },
  {
    name: 'recipe_convert rejects invalid system',
    input: {
      tool: 'recipe_convert',
      args: { recipe: { name: 'T', servings: 1, ingredients: [] }, unit_system: 'alien' },
    },
    expected: { error: 'Invalid unit system' },
  },
  {
    name: 'recipe_filter returns gluten-free rules',
    input: { tool: 'recipe_filter', args: { dietary: ['gluten-free'] } },
    expected: { filters: 'array_length_1', tips: 'array' },
  },
  {
    name: 'recipe_filter handles multiple diets',
    input: { tool: 'recipe_filter', args: { dietary: ['vegan', 'gluten-free'] } },
    expected: { filters: 'array_length_2' },
  },
] as { name: string; input: Record<string, unknown>; expected: Record<string, unknown> }[];
