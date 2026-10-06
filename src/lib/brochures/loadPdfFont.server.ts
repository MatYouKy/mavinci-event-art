import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Embed font bytes in the PDF document: Chromium then needs neither CORS access
// nor a request back to the application that is currently generating the PDF.
export async function loadPdfFont(url: string | null, label: string, localInter = false): Promise<string | null> {
  if (!url) return null;
  let bytes: Buffer;
  if (localInter) {
    try {
      bytes = await readFile(join(process.cwd(), 'public', 'fonts', 'Inter-Variable.ttf'));
    } catch {
      throw new Error('Generator PDF nie ma dostępu do lokalnego pliku Inter. Sprawdź, czy wdrożenie zawiera public/fonts/Inter-Variable.ttf.');
    }
  } else {
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    } catch {
      throw new Error(`Nie udało się pobrać fontu „${label}” do PDF. Spróbuj ponownie za chwilę.`);
    }
  }
  const signature = bytes.subarray(0, 4).toString('ascii');
  const mime = bytes.length >= 4 && bytes.readUInt32BE(0) === 0x00010000 ? 'font/ttf'
    : signature === 'OTTO' ? 'font/otf'
      : signature === 'wOFF' ? 'font/woff'
        : signature === 'wOF2' ? 'font/woff2' : null;
  if (!mime) throw new Error(`Plik fontu „${label}” nie jest obsługiwanym plikiem TTF, OTF, WOFF lub WOFF2.`);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
