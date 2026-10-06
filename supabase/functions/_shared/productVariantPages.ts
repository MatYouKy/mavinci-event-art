export function paginateProductVariants<T>(items: readonly T[]): T[][] {
  const pages: T[][] = [];
  let offset = 0;
  while (offset < items.length) {
    const remaining = items.length - offset;
    const size = remaining === 4 ? 2 : Math.min(3, remaining);
    pages.push(items.slice(offset, offset + size));
    offset += size;
  }
  return pages;
}
