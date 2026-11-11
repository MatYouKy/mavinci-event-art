import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildCompanyEmailBody, buildCompanySignatureHtml } from '@/lib/buildCompanySignature';
import type { MessageDetails } from '@/lib/CRM/messages/messagesQueries';

/*
 * Wiadomości w aplikacji na Maca — HTML podglądu i wysyłki budowany na serwerze tymi samymi regułami co w przeglądarce
 * (`EmailHtmlPreview`, `ComposeEmailModal`, `UnifiedEmailComposer`): usunięte aktywne elementy, obrazy `cid:` historycznej
 * stopki, cytat odpowiedzi „Dnia …, użytkownik … napisał:”, stopka i szablon firmy wybranej skrzynki.
 */

export const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const replaceCidImages = (html: string, replacementSources: string[] = []) => {
  let imageIndex = 0;
  return html.replace(/<img\b[^>]*\bsrc\s*=\s*(["'])cid:[^"']+\1[^>]*>/gi, (tag) => {
    const replacement = replacementSources[imageIndex];
    imageIndex += 1;
    if (!replacement) return '';
    return tag.replace(/(\bsrc\s*=\s*)(["'])cid:[^"']+\2/i, (_source, prefix: string, quote: string) => `${prefix}${quote}${replacement}${quote}`);
  });
};

const extractImageSources = (html: string) =>
  Array.from(html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1/gi)).map((match) => match[2]).filter(Boolean);

const removeActiveEmailContent = (html: string) =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<(?:object|embed)\b[^>]*>[\s\S]*?<\/(?:object|embed)>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*(["'])?refresh\1?[^>]*>/gi, '');

const previewStyles = `
  <meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: light; }
    html, body { margin: 0; padding: 0; min-height: 100%; background: #ffffff; color: #1c1f33; }
    body { padding: 18px; box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
    img { max-width: 100%; height: auto; }
    table { max-width: 100%; }
    a { color: #7f1734; }
    blockquote { margin-left: 0; padding-left: 14px; border-left: 3px solid #d3bb73; }
  </style>
`;

/*
 * Obrazy z adresów `http://` i `//…` → `https://` — tak jak przeglądarka podnosi je w podglądzie CRM (treść mieszana).
 * macOS blokuje w aplikacjach połączenia bez szyfrowania, więc bez tego część logotypów w newsletterach się nie wczytuje.
 */
const upgradeInsecureMedia = (html: string) =>
  html
    .replace(/(\b(?:src|background|poster)\s*=\s*["']?\s*)(?:http:)?\/\//gi, '$1https://')
    .replace(/(url\(\s*["']?\s*)(?:http:)?\/\//gi, '$1https://');

/**
 * Treść bez własnych kolorów i tła (formularz kontaktowy, zwykłe maile tekstowe) — aplikacja może ją pokazać w ciemnym
 * motywie. Wiadomości z własnym wyglądem (newslettery, stopki z kolorami) zostają na białym tle, jak w CRM.
 */
export function isPlainEmailHtml(html: string): boolean {
  if (/<style\b|\bbgcolor\s*=|\bbackground\s*=|<font\b[^>]*\bcolor\s*=/i.test(html)) return false;
  for (const match of html.matchAll(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    if (match[2].split(';').some((rule) => /^\s*(?:color|background|background-color|background-image)\s*:/i.test(rule))) return false;
  }
  return true;
}

/** Pełny dokument do `WKWebView` (bez skryptów, ramek i odświeżania) — jak `buildPreviewDocument` w `EmailHtmlPreview`. */
export const emailPreviewDocument = (html: string) => {
  const safeHtml = upgradeInsecureMedia(removeActiveEmailContent(html));
  if (/<html\b/i.test(safeHtml)) {
    if (/<head\b[^>]*>/i.test(safeHtml)) return safeHtml.replace(/<head\b[^>]*>/i, (head) => `${head}${previewStyles}`);
    return safeHtml.replace(/<html\b[^>]*>/i, (root) => `${root}<head>${previewStyles}</head>`);
  }
  return `<!doctype html><html><head>${previewStyles}</head><body>${safeHtml}</body></html>`;
};

/** Treść HTML wiadomości z odtworzonymi obrazami stopki (`cid:`), tak jak podgląd w przeglądarce. */
export async function messagePreviewHtml(client: SupabaseClient, details: MessageDetails): Promise<string | null> {
  const html = details.bodyHtml?.trim();
  if (!html) return null;
  const employeeId = details.originalData?.employee_id ?? null;
  const emailAccountId = details.email_account_id ?? null;
  let resolved = replaceCidImages(html);
  if (/\bsrc\s*=\s*(["'])cid:/i.test(html) && (employeeId || emailAccountId)) {
    try {
      const signature = await buildCompanySignatureHtml({ client, employeeId, emailAccountId });
      resolved = replaceCidImages(html, extractImageSources(signature.html));
    } catch (error) {
      console.warn('[native/messages] Nie udało się odtworzyć obrazów historycznej stopki:', error);
    }
  }
  return emailPreviewDocument(resolved);
}

const sanitizeQuotedEmailHtml = (html: string) =>
  removeActiveEmailContent(html)
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<(style|form|button|input|select|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?:meta|link|base|input)\b[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '')
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '');

/** Cytat odpowiedzi — identyczny układ jak `buildReplyQuoteHtml` w `ComposeEmailModal`. */
export const replyQuoteHtml = (details: MessageDetails) => {
  const originalHtml = details.bodyHtml?.trim()
    ? sanitizeQuotedEmailHtml(details.bodyHtml)
    : escapeHtml(details.body || '').replace(/\n/g, '<br>');
  const formattedDate = new Date(details.date).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'long', timeStyle: 'short' });
  const messageId = details.originalData?.message_id as string | undefined;
  return `
    <div style="margin:24px 0 0; padding:0; color:#4b5563; background:#ffffff; font-family:Arial,sans-serif; font-size:13px; line-height:1.5;">
      <div class="moz-cite-prefix" style="margin:0 0 8px; color:#4b5563;">
        Dnia ${escapeHtml(formattedDate)}, użytkownik ${escapeHtml(details.from)} napisał:
      </div>
      <blockquote type="cite"${messageId ? ` cite="mid:${escapeHtml(messageId)}"` : ''} style="margin:0; padding:0 0 0 14px; border-left:2px solid #729fcf; color:#1f2937; background:#ffffff;">
        ${originalHtml}
      </blockquote>
    </div>`;
};

/** Tekst z edytora aplikacji → akapity jak z edytora CRM (pusta linia = `<p><br></p>`, zachowane wielokrotne spacje). */
export const plainTextToEmailHtml = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const escaped = escapeHtml(line.replace(/\t/g, '    ')).replace(/ {2,}/g, (spaces) => ' '.repeat(spaces.length - 1) + ' ');
      return `<p>${escaped || '<br>'}</p>`;
    })
    .join('');

/** Ostateczny HTML wysyłki: treść, stopka i szablon firmy skrzynki nadawczej, cytat — jak `buildUnifiedEmailHtml`. */
export async function composeEmailHtml(client: SupabaseClient, opts: {
  employeeId: string;
  accountId: string;
  subject: string;
  text: string;
  quotedHtml?: string;
}): Promise<string> {
  const signature = await buildCompanySignatureHtml({ client, employeeId: opts.employeeId, emailAccountId: opts.accountId });
  const result = await buildCompanyEmailBody({
    client,
    employeeId: opts.employeeId,
    emailAccountId: opts.accountId,
    content: plainTextToEmailHtml(opts.text),
    contentIsHtml: true,
    subject: opts.subject,
    signatureHtml: signature.html,
    purpose: 'general',
  });
  return `${result.html}${opts.quotedHtml || ''}`;
}

/** Nagłówki wątku dla odpowiedzi na odebraną wiadomość (`In-Reply-To`, `References`). */
export function replyThreadHeaders(details: MessageDetails): { inReplyTo?: string; references?: string[] } {
  if (details.type !== 'received') return {};
  const inReplyTo = (details.originalData?.message_id as string | undefined) || undefined;
  const rawReferences = details.originalData?.raw_headers?.references;
  const parsed: string[] = Array.isArray(rawReferences)
    ? rawReferences.map(String)
    : typeof rawReferences === 'string'
      ? rawReferences.match(/<[^>]+>/g) || rawReferences.split(/\s+/).filter(Boolean)
      : [];
  return { inReplyTo, references: inReplyTo ? Array.from(new Set([...parsed, inReplyTo])) : parsed };
}

/** Adres do odpowiedzi — jak `extractReplyAddress` w `MessagesPageClient`. */
export function replyAddress(details: MessageDetails): string {
  const original = details.originalData || {};
  const candidate = (details.type === 'contact_form' ? original.email : original.reply_to || original.from_address) || details.from;
  const bracket = String(candidate).match(/<([^>]+)>/);
  return (bracket?.[1] || candidate || '').trim();
}
