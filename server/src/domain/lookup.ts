// Tables keyed by user input (units, synonyms, plan names, ...) are built without a prototype, so
// names such as "constructor" or "toString" are not mistaken for entries.
export function lookup<T>(entries: Record<string, T>): Record<string, T> {
  return Object.freeze(Object.assign(Object.create(null) as Record<string, T>, entries));
}
