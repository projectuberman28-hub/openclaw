# Recipe Scaler
## Description
Scale recipe ingredients proportionally, generate consolidated shopping lists, convert between metric and imperial units, and filter recipes by dietary requirements including gluten-free.

## Tools
- `recipe_scale(recipe: Recipe, servings: number)` — Scale a recipe to target servings. Returns `{ scaled: Recipe }`.
- `recipe_shopping_list(recipes: Recipe[])` — Consolidate ingredients into a shopping list. Returns `{ list: ShoppingItem[] }`.
- `recipe_convert(recipe: Recipe, unit_system: string)` — Convert units between metric and imperial. Returns `{ converted: Recipe }`.
- `recipe_filter(dietary: string[])` — Filter/flag ingredients for dietary needs. Returns `{ flags: DietaryFlag[] }`.

## Dependencies
- None (pure computation)

## Fallbacks
- If ingredient parsing fails, return unmodified with warning
- If unit is unrecognized, pass through without conversion
- Common fraction handling (1/2, 1/3, 3/4, etc.)
