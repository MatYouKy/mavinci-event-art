export interface EmailBodyPlaceholderValues {
  content?: string;
  subject?: string;
  recipient_name?: string;
  sender_name?: string;
  sender_email?: string;
  company_logo?: string;
  company_name?: string;
  company_website?: string;
  brand_primary_color?: string;
  brand_secondary_color?: string;
  brand_accent_color?: string;
  signature?: string;
  pdf_link?: string;
}

export const EMAIL_BODY_PLACEHOLDERS: { key: keyof EmailBodyPlaceholderValues; label: string }[] = [
  { key: 'content', label: 'Treść wiadomości' },
  { key: 'subject', label: 'Temat' },
  { key: 'recipient_name', label: 'Nazwa odbiorcy' },
  { key: 'sender_name', label: 'Nazwa nadawcy' },
  { key: 'sender_email', label: 'Email nadawcy' },
  { key: 'company_logo', label: 'Logo firmy' },
  { key: 'company_name', label: 'Nazwa firmy' },
  { key: 'company_website', label: 'WWW firmy' },
  { key: 'brand_primary_color', label: 'Kolor primary' },
  { key: 'brand_secondary_color', label: 'Kolor secondary' },
  { key: 'brand_accent_color', label: 'Kolor accent' },
  { key: 'signature', label: 'Stopka (HTML)' },
  { key: 'pdf_link', label: 'Blok z linkiem do PDF' },
];

export function renderEmailBodyTemplate(
  template: string,
  values: EmailBodyPlaceholderValues,
): string {
  if (!template) return '';
  let out = template;
  for (const { key } of EMAIL_BODY_PLACEHOLDERS) {
    const re = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    out = out.replace(re, String(values[key] ?? ''));
  }
  return out;
}

export const DEFAULT_EMAIL_BODY_TEMPLATE = `<div style="font-family: 'Helvetica Neue', Arial, sans-serif; background: #f5f5f5; padding: 24px 0; color: #1c1f33;">
  <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
    <div style="background: {{brand_primary_color}}; padding: 24px; text-align: center;">
      <img src="{{company_logo}}" alt="{{company_name}}" height="48" style="display: inline-block; max-height: 48px;" />
    </div>
    <div style="padding: 32px 28px; font-size: 14px; line-height: 1.6; color: #1c1f33;">
      <div style="white-space: pre-wrap;">{{content}}</div>
      {{pdf_link}}
    </div>
    <div style="padding: 24px 28px; border-top: 1px solid #ececec;">
      {{signature}}
    </div>
  </div>
  <div style="max-width: 640px; margin: 12px auto 0; text-align: center; font-size: 11px; color: #888;">
    Wiadomość wysłana z {{company_name}}
  </div>
</div>`;
