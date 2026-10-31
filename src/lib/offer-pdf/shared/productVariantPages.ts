export function productVariantPageLayout(pageIndex: number) {
  const continuation = pageIndex > 0;
  return {
    continuation,
    sectionTop: continuation ? 42 : 350,
    rowsTop: continuation ? 82 : 382,
    rowStep: 132,
    capacity: continuation ? 5 : 3,
  };
}

export function paginateProductVariants<T>(items: readonly T[]): T[][] {
  const pages: T[][] = [];
  let offset = 0;
  while (offset < items.length) {
    const remaining = items.length - offset;
    const { capacity } = productVariantPageLayout(pages.length);
    // Fill each page to its capacity: 3 on the opening page, 5 on continuations.
    // Preview and PDF must keep the same ordering and page boundaries.
    const size = Math.min(capacity, remaining);
    pages.push(items.slice(offset, offset + size));
    offset += size;
  }
  return pages;
}
