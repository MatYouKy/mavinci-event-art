// Krój nagłówków kalkulacji z motywu marki (`get_public_brand_theme`) — wspólny dla wydruku w przeglądarce i na Macu.
export type PublicBrandTheme = {
  heading_font_family?: string | null;
  heading_font_weight?: string | null;
  heading_font_url?: string | null;
};

const getFontFormat = (url: string) => {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith('.woff2')) return 'woff2';
  if (pathname.endsWith('.woff')) return 'woff';
  if (pathname.endsWith('.otf')) return 'opentype';
  return 'truetype';
};

export const buildCalculationHeadingFontCss = (theme: PublicBrandTheme | null) => {
  const family = String(theme?.heading_font_family || 'Atom')
    .replace(/[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ _-]/g, '')
    .trim() || 'Atom';
  const weight = String(theme?.heading_font_weight || '400').replace(/[^0-9]/g, '') || '400';
  let fontUrl = '';

  try {
    const parsed = new URL(String(theme?.heading_font_url || ''));
    if (parsed.protocol === 'https:') fontUrl = parsed.toString();
  } catch {
    fontUrl = '';
  }

  const fontFace = fontUrl
    ? `@font-face{font-family:'${family}';src:url('${fontUrl}') format('${getFontFormat(fontUrl)}');font-weight:${weight};font-style:normal;font-display:block;}`
    : '';

  return `${fontFace}
    header h1,
    header .company-name,
    section h2,
    table.items th,
    .summary-table .label,
    .technical-title,
    .power-section-title,
    .power-box .label,
    .grand .label {
      font-family:'${family}','Atom','Montserrat',Arial,sans-serif;
      font-weight:${weight};
      text-transform:uppercase;
    }`;
};
