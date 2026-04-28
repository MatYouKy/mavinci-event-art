export interface SignaturePlaceholderValues {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  phone?: string;
  email?: string;
  website?: string;
  avatar_url?: string;
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
  brand_primary_color?: string;
  brand_secondary_color?: string;
  brand_accent_color?: string;
}

export const SIGNATURE_PLACEHOLDERS: { key: keyof SignaturePlaceholderValues; label: string }[] = [
  { key: 'full_name', label: 'Imię i nazwisko' },
  { key: 'first_name', label: 'Imię' },
  { key: 'last_name', label: 'Nazwisko' },
  { key: 'position', label: 'Stanowisko' },
  { key: 'phone', label: 'Telefon' },
  { key: 'email', label: 'Email' },
  { key: 'website', label: 'Strona WWW' },
  { key: 'avatar_url', label: 'Miniaturka pracownika (URL)' },
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
  for (const { key } of SIGNATURE_PLACEHOLDERS) {
    const re = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    out = out.replace(re, String(values[key] ?? ''));
  }
  return out;
}

export const DEFAULT_SIGNATURE_TEMPLATE = `<div style="font-family: system-ui, -apple-system, sans-serif; color: #1c1f33; max-width: 560px;">
  <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
    <tr>
      <td style="vertical-align: top; padding-right: 16px;">
        {{avatar_url}}
        <img src="{{avatar_url}}" alt="{{full_name}}" width="120" height="120" style="display: block; border-radius: 8px;" />
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
