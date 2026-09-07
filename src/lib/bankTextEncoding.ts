import { decodeTextEntities } from '@/lib/textEncoding';

const UTF8_MOJIBAKE_MARKERS = /[\uFFFD\u0400-\u04FF]|(?:Ã.|Â.|Ä.|Å.|Ă.|Ĺ.)/gu;

function encodingErrorScore(value: string): number {
  const mojibake = value.match(UTF8_MOJIBAKE_MARKERS)?.length || 0;
  const controls = value.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g)?.length || 0;

  return mojibake * 10 + controls * 5;
}

/**
 * Wyciągi MT940 polskich banków są często zapisane jako Windows-1250.
 * Samo File.text() zawsze używa UTF-8 i może wtedy zamienić bajty „ÓŁ” na „ӣ”.
 */
export async function readBankTextFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');

  try {
    const windows1250 = new TextDecoder('windows-1250')
      .decode(bytes)
      .replace(/^\uFEFF/, '');

    return encodingErrorScore(windows1250) < encodingErrorScore(utf8)
      ? windows1250
      : utf8;
  } catch {
    return utf8;
  }
}

/**
 * Naprawia również dane zaimportowane przed poprawką dekodowania.
 */
export function repairBrokenBankText(value?: string | null): string {
  if (!value) return '';

  return decodeTextEntities(value)
    .replace(/ӣ/g, 'ÓŁ')
    .replace(/�/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/RACHU NKU/g, 'RACHUNKU')
    .replace(/ROZL ICZENIOWE/g, 'ROZLICZENIOWE')
    .replace(/OP ATA/g, 'OPŁATA')
    .replace(/URZ D/g, 'URZĄD')
    .replace(/SKARBOWY CENTRUM ROZL ICZENIOWE/g, 'SKARBOWY CENTRUM ROZLICZENIOWE')
    .trim();
}
