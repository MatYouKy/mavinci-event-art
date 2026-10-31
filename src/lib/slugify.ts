/** Used for new URLs only. Renaming content must not change published addresses. */
export function slugify(text: string): string {
  return text.toLocaleLowerCase('pl-PL').replace(/ł/g, 'l').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
