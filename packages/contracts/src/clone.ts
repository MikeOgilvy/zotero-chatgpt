/**
 * Deep copy for JSON-shaped data (plain objects, arrays, primitives). Gecko plugin sandboxes do not
 * expose `structuredClone`, and none of the reader's contracts carry other value types.
 */
export function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => clone(item) as unknown) as unknown as T;
  const source = value as Record<string, unknown>; const result: Record<string, unknown> = {};
  for (const key of Object.keys(source)) result[key] = clone(source[key]);
  return result as T;
}
