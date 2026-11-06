// How catalog food names lead. USDA usually leads with the food ("Banana, raw"), but some names lead with a
// category and put the food second ("Fish, salmon, baked", "Cheese, paneer", "Bread, naan"). Search ranking and
// portion choice both need the word people actually say for the food, so they share this.

// Leading segments that are a category, not the food. Compound names whose first word is the food itself
// ("Soup, tomato", "Pie, apple", "Cookies, chocolate chip") are deliberately not listed.
const CATEGORY_HEADS = new Set([
  'fish', 'cheese', 'bread', 'beverages', 'nuts', 'seeds', 'spices', 'candies', 'snacks', 'cereals',
  'cereals ready-to-eat', 'game meat', 'alcoholic beverage',
]);

/** The leading name segments that name the food: the first, plus the second after a category ("fish", "salmon"). */
export function headSegments(name: string): string[] {
  const [first, second] = name.toLowerCase().split(/[,(]/).map((s) => s.trim());
  return CATEGORY_HEADS.has(first) && second ? [first, second] : [first];
}
