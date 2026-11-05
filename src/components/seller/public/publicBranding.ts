/** Hotel branding for the public guest pages (only public URLs and valid colours are used). */
export type PublicBranding = { primary: string; accent: string; onPrimary: string; logoUrl: string | null };

const hex = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : null;
// Publiczny adres https albo własna trasa serwera (/bridge/public/…) podpisująca plik z prywatnego bucketu.
const publicUrl = (value: unknown) => typeof value === 'string' && (/^https:\/\//i.test(value.trim()) || value.trim().startsWith('/bridge/public/')) ? value.trim() : null;

function luminance(color: string) {
  const channel = (index: number) => {
    const value = parseInt(color.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function publicBranding(snapshot: unknown, fallbackLogo?: string | null): PublicBranding {
  const data = snapshot && typeof snapshot === 'object' ? snapshot as Record<string, unknown> : {};
  const primary = hex(data.brand_primary_color) || '#1c1f33';
  const accent = hex(data.brand_secondary_color) || '#d3bb73';
  return {
    primary,
    accent,
    onPrimary: luminance(primary) > 0.45 ? '#16131a' : '#ffffff',
    logoUrl: publicUrl(data.hotel_logo_url) || publicUrl(fallbackLogo),
  };
}

export const publicText = (snapshot: unknown, key: string) => {
  const data = snapshot && typeof snapshot === 'object' ? snapshot as Record<string, unknown> : {};
  const value = data[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

export const publicDate = (value: string | null | undefined) => {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Warsaw' }) : null;
};

export const publicMoney = (value: number | string | null | undefined) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: 2 }).format(Number(value || 0));
