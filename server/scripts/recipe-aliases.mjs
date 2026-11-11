/** Reviewed aliases for recipe foods (data/aliases/recipes.json). */
export function recipeAliases(entries, foodsByName) {
  const out = new Map();
  const seen = new Set();
  for (const e of entries) {
    const alias = String(e.alias ?? '').trim().toLowerCase();
    const label = `Recipe alias "${e.alias}"`;
    if (!/^[a-z][a-z '-]*$/.test(alias)) throw new Error(`${label}: aliases are plain lowercase words`);
    if (!/^https:\/\/\S+$/.test(e.reference ?? '')) throw new Error(`${label}: a public https reference is required`);
    const food = foodsByName.get(String(e.name ?? '').toLowerCase());
    if (!food) throw new Error(`${label}: no recipe named "${e.name}" in the catalog`);
    if (seen.has(alias)) throw new Error(`${label}: used for more than one food`);
    seen.add(alias);
    const prior = Array.isArray(food.aliases)
      ? food.aliases
      : food.aliases?.split('|').filter(Boolean) ?? [];
    const merged = [...new Set([...prior, alias])];
    out.set(food.id, merged);
  }
  return out;
}
