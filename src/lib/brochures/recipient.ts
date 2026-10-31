export type BrochureClient = {
  contactId?: string;
  organizationId?: string;
  name: string;
  organizationName?: string;
};

/** Nazwa dla odbiorcy; identyfikatory i wersje pozostają wyłącznie w historii CRM. */
export function brochureClientPdfFileName(client: BrochureClient): string {
  const clean = (value: string) => value.normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  const label = clean(client.organizationName || '') || clean(client.name || '');
  // Limit w bajtach chroni również nazwy z polskimi znakami lub innym alfabetem.
  const characters = Array.from(label).slice(0, 180);
  const encoder = new TextEncoder();
  while (encoder.encode(characters.join('')).byteLength > 180) characters.pop();
  const safeLabel = characters.join('').replace(/[. ]+$/g, '');
  return safeLabel ? `Broszura - ${safeLabel}.pdf` : 'Broszura.pdf';
}
