export interface SignaturePlaceholderValues {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  phone?: string;
  email?: string;
  website?: string;
  company_name?: string;
  company_legal_name?: string;
  company_address?: string;
  company_nip?: string;
  company_regon?: string;
  company_krs?: string;
  company_logo?: string;
  company_phone?: string;
  company_email?: string;
  company_website?: string;
  company_facebook_url?: string;
  company_instagram_url?: string;
  company_linkedin_url?: string;
  company_tiktok_url?: string;
  company_youtube_url?: string;
  brand_primary_color?: string;
  brand_secondary_color?: string;
  brand_accent_color?: string;
  signature_thumb?: string;
}

export const SIGNATURE_PLACEHOLDERS: { key: keyof SignaturePlaceholderValues; label: string }[] = [
  { key: 'full_name', label: 'Imię i nazwisko' },
  { key: 'first_name', label: 'Imię' },
  { key: 'last_name', label: 'Nazwisko' },
  { key: 'position', label: 'Stanowisko' },
  { key: 'phone', label: 'Telefon' },
  { key: 'email', label: 'Email' },
  { key: 'website', label: 'Strona WWW' },
  { key: 'signature_thumb', label: 'Miniaturka pracownika (base64)' },
  { key: 'company_name', label: 'Nazwa firmy' },
  { key: 'company_legal_name', label: 'Pełna nazwa firmy' },
  { key: 'company_address', label: 'Adres firmy' },
  { key: 'company_nip', label: 'NIP firmy' },
  { key: 'company_regon', label: 'REGON firmy' },
  { key: 'company_krs', label: 'KRS firmy' },
  { key: 'company_logo', label: 'Logo firmy (URL)' },
  { key: 'company_phone', label: 'Telefon firmy' },
  { key: 'company_email', label: 'Email firmy' },
  { key: 'company_website', label: 'WWW firmy' },
  { key: 'company_facebook_url', label: 'Facebook marki' },
  { key: 'company_instagram_url', label: 'Instagram marki' },
  { key: 'company_linkedin_url', label: 'LinkedIn marki' },
  { key: 'company_tiktok_url', label: 'TikTok marki' },
  { key: 'company_youtube_url', label: 'YouTube marki' },
  { key: 'brand_primary_color', label: 'Kolor primary' },
  { key: 'brand_secondary_color', label: 'Kolor secondary' },
  { key: 'brand_accent_color', label: 'Kolor accent' },
];

export function renderSignatureTemplate(
  template: string,
  values: SignaturePlaceholderValues,
): string {
  if (!template) return '';
  let out = template;

  const optionalLinkKeys: Array<
    | 'company_facebook_url'
    | 'company_instagram_url'
    | 'company_linkedin_url'
    | 'company_tiktok_url'
    | 'company_youtube_url'
  > = [
    'company_facebook_url',
    'company_instagram_url',
    'company_linkedin_url',
    'company_tiktok_url',
    'company_youtube_url',
  ];

  for (const key of optionalLinkKeys) {
    if (String(values[key] ?? '').trim()) continue;
    out = out.replace(
      new RegExp(
        `<a\\b[^>]*href\\s*=\\s*["']\\s*{{\\s*${key}\\s*}}\\s*["'][^>]*>[\\s\\S]*?<\\/a>`,
        'gi',
      ),
      '',
    );
  }

  const removeEmptyRegistryPlaceholder = (
    html: string,
    key: 'company_nip' | 'company_regon' | 'company_krs',
    label: 'NIP' | 'REGON' | 'KRS',
  ) => {
    if (String(values[key] ?? '').trim()) return html;

    const token = `{{\\s*${key}\\s*}}`;
    const separator = '(?:\\||•|·|&middot;)';

    return html
      .replace(new RegExp(`${label}\\s*:?\\s*${token}\\s*${separator}\\s*`, 'gi'), '')
      .replace(new RegExp(`\\s*${separator}\\s*${label}\\s*:?\\s*${token}`, 'gi'), '')
      .replace(new RegExp(`${label}\\s*:?\\s*${token}`, 'gi'), '');
  };

  out = removeEmptyRegistryPlaceholder(out, 'company_nip', 'NIP');
  out = removeEmptyRegistryPlaceholder(out, 'company_regon', 'REGON');
  out = removeEmptyRegistryPlaceholder(out, 'company_krs', 'KRS');

  for (const { key } of SIGNATURE_PLACEHOLDERS) {
    const re = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    out = out.replace(re, String(values[key] ?? ''));
  }

  out = out
    .replace(/(?:<br\s*\/?>(?:\s|&nbsp;)*)+(?=<\/(?:div|p|span|td)>)/gi, '')
    .replace(/<(div|p|span)\b([^>]*)>(?:\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi, '');

  return normalizeSignatureHtml(stripUnavailableCompanyRegistryData(out, values));
}

export function stripUnavailableCompanyRegistryData(
  html: string,
  values: Pick<SignaturePlaceholderValues, 'company_nip' | 'company_regon' | 'company_krs'>,
): string {
  if (!html) return '';

  const separator = '(?:\\||•|·|&middot;)';
  const missingFields = [
    {
      missing: !String(values.company_nip ?? '').trim(),
      label: 'NIP',
      valuePattern: '(?:PL\\s*)?\\d(?:[\\s-]*\\d){9}',
    },
    {
      missing: !String(values.company_regon ?? '').trim(),
      label: 'REGON',
      valuePattern: '\\d(?:[\\s-]*\\d){8,13}',
    },
    {
      missing: !String(values.company_krs ?? '').trim(),
      label: 'KRS',
      valuePattern: '\\d(?:[\\s-]*\\d){9}',
    },
  ];

  let out = html;
  for (const field of missingFields) {
    if (!field.missing) continue;
    out = out
      .replace(
        new RegExp(
          `${field.label}\\s*:?\\s*${field.valuePattern}\\s*${separator}\\s*`,
          'gi',
        ),
        '',
      )
      .replace(
        new RegExp(
          `\\s*${separator}\\s*${field.label}\\s*:?\\s*${field.valuePattern}`,
          'gi',
        ),
        '',
      )
      .replace(
        new RegExp(`${field.label}\\s*:?\\s*${field.valuePattern}`, 'gi'),
        '',
      );
  }

  return out
    .replace(/(?:<br\s*\/?>(?:\s|&nbsp;)*)+(?=<\/(?:div|p|span|td)>)/gi, '')
    .replace(/<(div|p|span|td)\b([^>]*)>(?:\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi, '');
}

const mergeInlineStyle = (tag: string, requiredStyle: string): string => {
  if (/\sstyle\s*=\s*["']/i.test(tag)) {
    return tag.replace(
      /(\sstyle\s*=\s*["'])([^"']*)(["'])/i,
      (_match, opening: string, current: string, closing: string) =>
        `${opening}${current.replace(/\s*;?\s*$/, '; ')}${requiredStyle}${closing}`,
    );
  }
  return tag.replace(/\s*\/?>$/, (closing) =>
    ` style="${requiredStyle}"${closing.includes('/') ? ' />' : '>'}`,
  );
};

const ensureNumericDimensionAttribute = (
  tag: string,
  dimension: 'width' | 'height',
  value: string | undefined,
) => {
  if (!value || new RegExp(`\\s${dimension}\\s*=`, 'i').test(tag)) return tag;
  return tag.replace(/\s*\/?>$/, (closing) =>
    ` ${dimension}="${value}"${closing.includes('/') ? ' />' : '>'}`,
  );
};

const lockImageDimensions = (tag: string, spacingStyle = ''): string => {
  const width =
    tag.match(/\swidth\s*=\s*["']?(\d+)["']?/i)?.[1] ||
    tag.match(/style\s*=\s*["'][^"']*\bwidth\s*:\s*(\d+)px/i)?.[1];
  const height =
    tag.match(/\sheight\s*=\s*["']?(\d+)["']?/i)?.[1] ||
    tag.match(/style\s*=\s*["'][^"']*\bheight\s*:\s*(\d+)px/i)?.[1];
  const fixedSize = [
    width ? `width:${width}px !important; min-width:${width}px !important; max-width:${width}px !important;` : '',
    height ? `height:${height}px !important; min-height:${height}px !important; max-height:${height}px !important;` : '',
  ].join('');

  const tagWithDimensions = ensureNumericDimensionAttribute(
    ensureNumericDimensionAttribute(tag, 'width', width),
    'height',
    height,
  );

  return mergeInlineStyle(
    tagWithDimensions,
    `${fixedSize} display:inline-block !important; vertical-align:middle; border:0; outline:none; object-fit:contain; ${spacingStyle}`,
  );
};

/**
 * Ujednolica zapisane wcześniej stopki bez zmuszania użytkownika do ręcznej
 * przebudowy ich HTML. Klienci pocztowi potrafią nadawać obrazom display:block,
 * dlatego układ ikon musi być określony bezpośrednio w każdym tagu.
 */
export function normalizeSignatureHtml(html: string): string {
  if (!html) return '';

  const socialLinkPattern =
    /<a\b[^>]*href\s*=\s*["'][^"']*(?:facebook\.com|instagram\.com|linkedin\.com|tiktok\.com|youtube\.com|mavinci\.pl|eventrulers\.pl)[^"']*["'][^>]*>/gi;
  const contactLinkPattern = /<a\b[^>]*href\s*=\s*["'](?:tel:|mailto:)[^"']*["'][^>]*>/gi;

  let normalized = html
    .replace(/href\s*=\s*(["'])www\./gi, 'href=$1https://www.')
    .replace(socialLinkPattern, (tag) =>
      mergeInlineStyle(
        tag,
        'display:inline-block !important; vertical-align:middle; line-height:0; white-space:nowrap; padding-right:8px;',
      ),
    )
    .replace(contactLinkPattern, (tag) =>
      mergeInlineStyle(
        tag,
        'display:inline-block !important; vertical-align:middle; line-height:1.3; white-space:nowrap;',
      ),
    );

  normalized = normalized.replace(
    /(<a\b[^>]*href\s*=\s*["'][^"']*(?:facebook\.com|instagram\.com|linkedin\.com|tiktok\.com|youtube\.com|mavinci\.pl|eventrulers\.pl)[^"']*["'][^>]*>)([\s\S]*?)(<\/a>)/gi,
    (_match, opening: string, content: string, closing: string) => {
      const inlineImages = content.replace(/<img\b[^>]*>/gi, (tag) =>
        lockImageDimensions(tag),
      );
      return `${opening}${inlineImages}${closing}`;
    },
  );

  normalized = normalized.replace(
    /(<a\b[^>]*href\s*=\s*["'](?:tel:|mailto:)[^"']*["'][^>]*>)([\s\S]*?)(<\/a>)/gi,
    (_match, opening: string, content: string, closing: string) => {
      const inlineImages = content.replace(/<img\b[^>]*>/gi, (tag) =>
        lockImageDimensions(tag, 'margin-right:10px; margin-bottom:6px;'),
      );
      return `${opening}${inlineImages}${closing}`;
    },
  );

  // Obsługuje też starsze szablony, w których ikona jest osobnym obrazem
  // umieszczonym bezpośrednio przed linkiem telefonu lub adresu e-mail.
  normalized = normalized.replace(
    /(<img\b[^>]*>)(\s*)(<a\b[^>]*href\s*=\s*["'](?:tel:|mailto:)[^"']*["'][^>]*>)/gi,
    (_match, image: string, _spacing: string, link: string) =>
      `${lockImageDimensions(image, 'margin-right:10px; margin-bottom:6px;')}${mergeInlineStyle(
        link,
        'display:inline-block !important; vertical-align:middle; line-height:1.3; white-space:nowrap;',
      )}`,
  );

  // Ikona i wartość bywają zapisane jako dwa osobne linki rozdzielone <br>.
  // W stopce kontaktowej taki separator powinien być odstępem poziomym.
  normalized = normalized.replace(
    /<\/a>\s*(?:<br\s*\/?>\s*)?(?=<a\b[^>]*href\s*=\s*["'](?:tel:|mailto:))/gi,
    '</a><span style="display:inline-block; width:8px; line-height:1px;">&nbsp;</span>',
  );

  // Każdy obraz, również zdjęcie pracownika i logo poza linkiem, otrzymuje
  // rozmiar zapisany jednocześnie jako atrybut HTML i styl inline. Klient
  // pocztowy może usunąć jedno z nich podczas cytowania, ale nie oba.
  normalized = normalized.replace(/<img\b[^>]*>/gi, (tag) =>
    /\bmin-width\s*:\s*\d+px\s*!important/i.test(tag) ? tag : lockImageDimensions(tag),
  );

  // Białe znaki pomiędzy ikonami nie mogą stać się miejscem łamania wiersza.
  return normalized.replace(
    /<\/a>\s+(?=<a\b[^>]*href\s*=\s*["'][^"']*(?:facebook\.com|instagram\.com|linkedin\.com|tiktok\.com|youtube\.com|mavinci\.pl|eventrulers\.pl))/gi,
    '</a>',
  );
}

export const DEFAULT_SIGNATURE_TEMPLATE = `<div style="font-family: system-ui, -apple-system, sans-serif; color: #1c1f33; max-width: 560px;">
  <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
    <tr>
      <td style="vertical-align: top; padding-right: 16px;">
        <img src="{{signature_thumb}}" alt="{{full_name}}" width="120" height="120" style="display: block; border-radius: 8px;" />
      </td>
      <td style="vertical-align: top; border-left: 2px solid {{brand_primary_color}}; padding-left: 16px;">
        <div style="font-size: 16px; font-weight: 700; color: {{brand_primary_color}};">{{full_name}}</div>
        <div style="font-size: 13px; color: #6b6b6b; margin-top: 2px;">{{position}}</div>
        <div style="margin-top: 10px; font-size: 12px; line-height: 1.5;">
          <div>tel: <a href="tel:{{phone}}" style="color: inherit; text-decoration: none;">{{phone}}</a></div>
          <div>email: <a href="mailto:{{email}}" style="color: inherit; text-decoration: none;">{{email}}</a></div>
          <div><a href="{{website}}" style="color: {{brand_primary_color}}; text-decoration: none;">{{website}}</a></div>
        </div>
        <div style="margin-top: 12px;">
          <img src="{{company_logo}}" alt="{{company_name}}" height="32" style="display: block;" />
        </div>
        <div style="margin-top: 8px; font-size: 10px; color: #888;">
          {{company_legal_name}} | {{company_address}}<br />
          NIP: {{company_nip}} | KRS: {{company_krs}}
        </div>
      </td>
    </tr>
  </table>
</div>`;
