/** A download name, separate from the unique private storage path. */
export function offerPdfFileName(offerNumber: unknown): string {
  const number = String(offerNumber ?? '').trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 100) || 'bez_numeru';
  return `Oferta_${number}.pdf`;
}
