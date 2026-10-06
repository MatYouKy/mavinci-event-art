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

export const emailBodyTemplateHasPlaceholder = (
  template: string,
  key: keyof EmailBodyPlaceholderValues,
): boolean => new RegExp(`{{\\s*${key}\\s*}}`, 'i').test(template || '');

export const getMissingRequiredEmailPlaceholders = (
  template: string,
  options: { requireSignature?: boolean } = {},
): Array<'content' | 'signature'> => {
  const missing: Array<'content' | 'signature'> = [];
  if (!emailBodyTemplateHasPlaceholder(template, 'content')) missing.push('content');
  if (options.requireSignature && !emailBodyTemplateHasPlaceholder(template, 'signature')) {
    missing.push('signature');
  }
  return missing;
};

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

/**
 * Zapisany wcześniej szablon nie może usunąć właściwej treści wiadomości ani
 * stopki. Jeśli brakuje jednego z tych miejsc, korzystamy z kompletnego,
 * domyślnego układu zamiast wysyłać odbiorcy sam nagłówek lub pasek systemowy.
 */
export function renderSafeEmailBodyTemplate(
  template: string,
  values: EmailBodyPlaceholderValues,
): string {
  const missing = getMissingRequiredEmailPlaceholders(template, {
    requireSignature: Boolean(values.signature?.trim()),
  });
  const safeTemplate = missing.length > 0 ? DEFAULT_EMAIL_BODY_TEMPLATE : template;
  return renderEmailBodyTemplate(safeTemplate, values);
}

export const DEFAULT_EMAIL_BODY_TEMPLATE = `<style>
@media (prefers-color-scheme: dark) {
  .mavinci-message-shell { background:#191619 !important; color:#f3edf0 !important; }
  .mavinci-message-card, .mavinci-message-content { background:#242024 !important; color:#f3edf0 !important; }
  .mavinci-message-content div, .mavinci-message-content p { color:#f3edf0 !important; }
  .mavinci-message-footer { color:#cdbfc6 !important; }
}
</style><div class="mavinci-message-shell" style="font-family: 'Helvetica Neue', Arial, sans-serif; background: #f5f5f5; padding: 24px 0; color: #1c1f33;">
  <div class="mavinci-message-card" style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
    <div style="background: {{brand_primary_color}}; background-image:linear-gradient({{brand_primary_color}},{{brand_primary_color}}); padding: 24px; text-align: center;">
      <img src="{{company_logo}}" alt="{{company_name}}" height="48" style="display: inline-block; max-height: 48px;" />
    </div>
    <div class="mavinci-message-content" style="padding: 32px 28px; font-size: 14px; line-height: 1.6; color: #1c1f33;">
      <div style="white-space: pre-wrap;">{{content}}</div>
      {{pdf_link}}
    </div>
    <div style="padding: 24px 28px; border-top: 1px solid #ececec;">
      {{signature}}
    </div>
  </div>
  <div class="mavinci-message-footer" style="max-width: 640px; margin: 12px auto 0; text-align: center; font-size: 11px; color: #888;">
    Wiadomość wysłana z {{company_name}}
  </div>
</div>`;
