// Shared by the public demo and the existing seller PDF renderer.
export const DEMO_COMPANY_ID = 'd4474f90-5e61-4ba4-928e-c25c0f0659b5';
export const DEMO_PRODUCTS = [
  { id: '00f4e2f5-baae-4222-a19d-9030452ddf3a', name: 'DJ eventowy', description: 'Oprawa muzyczna wydarzenia, prowadzenie i kontakt z gośćmi. Program dopasowany do charakteru spotkania.' },
  { id: '19845058-0541-43c9-a222-f46fe0f327e7', name: 'Konferencja', description: 'Wsparcie techniczne konferencji: dźwięk, prezentacje i obsługa przebiegu spotkania.' },
  { id: '137230df-baf9-41af-8ee8-ff6b18148668', name: 'Ekran LED', description: 'Prezentacje, materiały filmowe i oprawa wizualna wydarzenia na ekranie LED.' },
] as const;
export const DEMO_PORTRAIT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const DEMO_PORTRAIT_MAX_DATA_LENGTH = 120_000;
export const DEMO_PORTRAIT_MAX_EDGE = 480;
export type SellerDemoInput = {
  title: string; website: string; portrait: string;
  fullName: string; organization: string; email: string; phone: string;
  primary: string; accent: string; surface: string; logo: string; cover: string; prices: string[];
};
export const DEFAULT_DEMO: SellerDemoInput = { title: 'Przykładowa oferta wydarzenia', website: '', portrait: '', fullName: '', organization: '', email: '', phone: '', primary: '#650026', accent: '#d3bb73', surface: '#faf7f2', logo: '', cover: '', prices: ['', '', ''] };
export function parseSellerDemoInput(raw: unknown): SellerDemoInput {
  const v = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const text = (key: string, limit: number) => typeof v[key] === 'string' ? (v[key] as string).replace(/[\x00-\x1f]/g, '').trim().slice(0, limit) : '';
  const color = (key: 'primary' | 'accent' | 'surface') => /^#[0-9a-f]{6}$/i.test(String(v[key] || '')) ? String(v[key]) : DEFAULT_DEMO[key];
  const logo = typeof v.logo === 'string' && v.logo.length <= 750_000 && /^data:image\/png;base64,[a-z0-9+/]+={0,2}$/i.test(v.logo) ? v.logo : '';
  const cover = typeof v.cover === 'string' && v.cover.length <= 1_500_000 && /^data:image\/png;base64,[a-z0-9+/]+={0,2}$/i.test(v.cover) ? v.cover : '';
  const portrait = typeof v.portrait === 'string' && v.portrait.length <= DEMO_PORTRAIT_MAX_DATA_LENGTH && /^data:image\/jpeg;base64,[a-z0-9+/]+={0,2}$/i.test(v.portrait) ? v.portrait : '';
  const websiteText = text('website', 200);
  const website = websiteText && !/^[a-z][a-z0-9+.-]*:/i.test(websiteText) ? `https://${websiteText}` : websiteText;
  const prices = DEMO_PRODUCTS.map((_, i) => {
    const value = Array.isArray(v.prices) ? v.prices[i] : null;
    return value == null || value === '' ? '' : typeof value === 'string' || typeof value === 'number' ? String(value).trim().replace(',', '.').slice(0, 32) : 'invalid';
  });
  return { title: text('title', 100), website, portrait, fullName: text('fullName', 120), organization: text('organization', 160), email: text('email', 200), phone: text('phone', 40), primary: color('primary'), accent: color('accent'), surface: color('surface'), logo, cover, prices };
}
export function demoInputError(v: SellerDemoInput) {
  if (v.website) {
    try {
      const value = /^[a-z][a-z0-9+.-]*:/i.test(v.website) ? v.website : `https://${v.website}`;
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password || /\s/.test(v.website)) throw new Error();
    } catch { return 'Wpisz prawidłowy adres strony, np. https://hotel.pl.'; }
  }
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return 'Wpisz prawidłowy e-mail służbowy.';
  if (v.prices.some(price => price !== '' && (!/^\d{1,6}([.,]\d{1,2})?$/.test(price) || Number(price.replace(',', '.')) > 999999.99))) return 'Wpisz cenę od 0 do 999 999,99 zł, maksymalnie dwa miejsca po przecinku.';
  return null;
}

// Both upload controls normalize to bounded PNGs before sending any image.
export function validateDemoImage(data: string) {
  if (!data) return;
  const bytes = Uint8Array.from(atob(data.split(',')[1] || ''), c => c.charCodeAt(0));
  const header = new DataView(bytes.buffer);
  if (bytes.length < 24 || Array.from(bytes.slice(0,8)).join(',') !== '137,80,78,71,13,10,26,10' || String.fromCharCode(...bytes.slice(12,16)) !== 'IHDR' || header.getUint32(16) < 1 || header.getUint32(20) < 1 || header.getUint32(16) > 1200 || header.getUint32(20) > 1200) throw new Error('Nieprawidłowa grafika. Dodaj ją ponownie jako PNG, JPG lub WEBP.');
}

// Portraits are re-encoded JPEGs, bounded both in bytes and dimensions.
export function validateDemoPortrait(data: string) {
  if (!data) return;
  const invalid = () => new Error('Nieprawidłowe zdjęcie stopki. Dodaj ponownie PNG, JPG lub WEBP do 5 MB.');
  if (data.length > DEMO_PORTRAIT_MAX_DATA_LENGTH || !/^data:image\/jpeg;base64,[a-z0-9+/]+={0,2}$/i.test(data)) throw invalid();
  const bytes = Uint8Array.from(atob(data.split(',')[1]), c => c.charCodeAt(0));
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw invalid();
  let offset = 2;
  while (offset < bytes.length - 1) {
    if (bytes[offset++] !== 0xff) throw invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw invalid();
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw invalid();
    if (marker === 0xc0 || marker === 0xc2) {
      if (length < 8) throw invalid();
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (width < 1 || height < 1 || width > DEMO_PORTRAIT_MAX_EDGE || height > DEMO_PORTRAIT_MAX_EDGE) throw invalid();
      return;
    }
    offset += length;
  }
  throw invalid();
}
