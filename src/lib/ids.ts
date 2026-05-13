/**
 * UUID v4. Workers' global crypto.randomUUID() is the right primitive.
 * Wrapped in a function so any future test can swap it without touching callers.
 */
export function newId(): string {
  return crypto.randomUUID();
}
