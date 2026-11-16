/*
 * Treść zapytania bez „szumu” poczty: cytowanych wcześniejszych wiadomości, stopek z danymi firmy, klauzul poufności
 * i RODO oraz dopisków programów pocztowych. Pełna treść zostaje w zapytaniu — to tylko widok do szybkiego czytania
 * (Mac, CRM). Bez pewności nie ucinamy: gdy po wycięciu zostałoby mniej niż kilka słów, zwracamy całość.
 */

/** Linie, od których zaczyna się cytowana wcześniejsza wiadomość — wszystko od nich w dół jest pomijane. */
const QUOTE_START = [
  /^-{2,}\s*(original message|wiadomość oryginalna|oryginalna wiadomość|forwarded message|wiadomość przekazana)\s*-{2,}/i,
  /^(w dniu|dnia)\s.{4,120}(napisał|napisała|napisał\(a\)|pisze)\s*:?\s*$/i,
  /^on\s.{4,160}wrote:\s*$/i,
  /^(od|from)\s*:\s*.+$/i,
  /^_{8,}\s*$/,
];

/** Początki klauzul poufności i RODO — od nich do końca wiadomości. */
const DISCLAIMER_START = [
  /^uwaga\s*:\s*(ta\s+)?wiadomość\s+(jest\s+)?(przeznaczona|poufna|może)/i,
  /^(attention|confidentiality notice|disclaimer|notice)\s*:\s*(this\s+)?(e-?mail|message|transmission)/i,
  /^(this\s+)?(e-?mail|message)\s+(is|and any attachments)\s+(intended|confidential)/i,
  /^(informacja|klauzula)\s+(o\s+)?(poufności|informacyjna|rodo)/i,
  /^zgodnie z (art\.|rozporządzeniem|rodo)/i,
  /^administratorem\s+(pani|pana|twoich)?\s*danych/i,
  /^treść tej wiadomości (jest poufna|może zawierać)/i,
];

/** Pojedyncze linie dopisków programów pocztowych i stopki technicznej. */
const NOISE_LINE = [
  /^(wysłane|wysłano)\s+(z|ze)\s+(mojego|aplikacji|programu)\b/i,
  /^sent from my\b/i,
  /^get outlook for\b/i,
  /^<?(https?:\/\/|mailto:|tel:)\S+>?$/i,
  /^(przeczytaj jak dbamy o|read how we care about)\b/i,
];

const SIGNATURE_DELIMITER = /^--\s*$/;

export type CleanInquiryMessage = {
  /** Treść do szybkiego czytania. */
  text: string;
  /** Czy coś zostało pominięte (pokaż „Pokaż całą wiadomość”). */
  trimmed: boolean;
};

const words = (value: string) => value.split(/\s+/).filter(Boolean).length;

export function cleanInquiryMessage(input: string | null | undefined): CleanInquiryMessage {
  const original = String(input || '').replace(/\r\n?/g, '\n').trim();
  if (!original) return { text: '', trimmed: false };
  const lines = original.split('\n');
  const kept: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('>')) continue;
    if (QUOTE_START.some((pattern) => pattern.test(line))) break;
    if (DISCLAIMER_START.some((pattern) => pattern.test(line))) break;
    if (SIGNATURE_DELIMITER.test(line)) break;
    if (NOISE_LINE.some((pattern) => pattern.test(line))) continue;
    // Adresy wklejone przez program pocztowy obok tekstu („<tel:+48…> +48 …”, „<mailto:…> adres”).
    kept.push(raw.replace(/<(?:tel|mailto|https?):[^>\s]+>\s*/gi, '').trimEnd());
  }
  const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (words(text) < 4) return { text: original, trimmed: false };
  return { text, trimmed: text.length < original.length - 1 };
}
