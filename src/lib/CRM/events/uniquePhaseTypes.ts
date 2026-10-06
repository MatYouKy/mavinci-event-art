type NamedPhaseType = { id: string; name: string; updated_at?: string; created_at?: string };
export const phaseTypeNameKey = (name: string) =>
  name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl-PL');
/** Prefer the most recently configured definition, while retaining original query order. */
export function uniquePhaseTypes<T extends NamedPhaseType>(types: T[]): T[] {
  const latest = new Map<string, T>();
  for (const type of types) {
    const key = phaseTypeNameKey(type.name);
    const previous = latest.get(key);
    const timestamp = (value?: string) => {
      const parsed = Date.parse(value || '');
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const compare = (left: T, right: T) =>
      timestamp(left.updated_at) - timestamp(right.updated_at) ||
      timestamp(left.created_at) - timestamp(right.created_at) ||
      left.id.localeCompare(right.id);
    if (!previous || compare(type, previous) > 0) latest.set(key, type);
  }
  return Array.from(latest.values());
}
