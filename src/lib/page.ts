export function page<T>(items: T[], offset: number, size: number): { items: T[]; next: number | null } {
  const next = offset + size;
  return { items: items.slice(offset, next), next: next < items.length ? next : null };
}
