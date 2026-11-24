import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildCompanyEmailBody, buildCompanySignatureHtml } from '@/lib/buildCompanySignature';
import type { MessageDetails } from '@/lib/CRM/messages/messagesQueries';

/*
 * Wiadomości w aplikacji na Maca — HTML podglądu i wysyłki budowany na serwerze tymi samymi regułami co w przeglądarce
 * (`EmailHtmlPreview`, `ComposeEmailModal`, `UnifiedEmailComposer`): usunięte aktywne elementy, obrazy `cid:` historycznej
 * stopki, cytat odpowiedzi „Dnia …, użytkownik … napisał:”, stopka i szablon firmy wybranej skrzynki. Treść z edytora na Macu
 * (formatowanie jak w Thunderbirdzie) przychodzi jako HTML z odstępami zapisanymi w stylach (`sanitizeMailContentHtml` zostawia
 * tylko znaczniki i style treści), więc odbiorca widzi to samo co okno treści.
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

/**
 * Zwykły tekst (np. wiadomość z zapytania w aplikacji) → wiersze bez dodatkowych odstępów: każdy wiersz to akapit z `margin:0`
 * (pusta linia = pusty wiersz), więc wiadomość wygląda jak pole treści — bez domyślnych marginesów akapitów w programach poczty.
 */
export const plainTextToEmailHtml = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const escaped = escapeHtml(line.replace(/\t/g, '    ')).replace(/ {2,}/g, (spaces) => '&nbsp;'.repeat(spaces.length - 1) + ' ');
      return `<p style="margin:0">${escaped || '<br>'}</p>`;
    })
    .join('');

// MARK: Treść HTML z edytora na Macu

const MAIL_TAGS = new Set(['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'a', 'ul', 'ol', 'li', 'blockquote',
  'span', 'font', 'sub', 'sup', 'h1', 'h2', 'h3', 'hr']);
const MAIL_VOID = new Set(['br', 'hr']);
const MAIL_DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math', 'head',
  'title', 'textarea', 'select', 'button', 'video', 'audio', 'canvas']);
const LENGTH = String.raw`(?:0|-?\d{1,4}(?:\.\d{1,3})?(?:px|em|rem|pt|%))`;
const MAIL_STYLES: Record<string, RegExp> = {
  'text-align': /^(?:left|right|center|justify|start|end)$/i,
  margin: new RegExp(String.raw`^(?:(?:${LENGTH}|auto)\s*){1,4}$`, 'i'),
  'margin-top': new RegExp(`^${LENGTH}$`, 'i'),
  'margin-right': new RegExp(`^${LENGTH}$`, 'i'),
  'margin-bottom': new RegExp(`^${LENGTH}$`, 'i'),
  'margin-left': new RegExp(`^${LENGTH}$`, 'i'),
  padding: new RegExp(String.raw`^(?:${LENGTH}\s*){1,4}$`, 'i'),
  'padding-left': new RegExp(`^${LENGTH}$`, 'i'),
  color: /^(?:#[\da-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)|[a-z]{3,20})$/i,
  'font-weight': /^(?:bold|bolder|normal|[1-9]00)$/i,
  'font-style': /^(?:italic|normal|oblique)$/i,
  'text-decoration': /^(?:none|underline|line-through)(?:\s+(?:underline|line-through))?$/i,
  'text-decoration-line': /^(?:none|underline|line-through)(?:\s+(?:underline|line-through))?$/i,
  'font-size': /^(?:\d{1,3}(?:\.\d{1,2})?(?:px|pt|em|rem|%)|x-small|small|medium|large|x-large|xx-large)$/i,
  border: /^none$/i,
  'list-style-type': /^(?:disc|circle|square|decimal|lower-alpha|upper-alpha|lower-roman|upper-roman|none)$/i,
};
const escapeMailText = (value: string) =>
  value.replace(/&(?!(?:[a-z]+|#\d+|#x[\da-f]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeMailAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decodeAttribute = (value: string) => value.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Tylko dozwolone właściwości stylu z bezpiecznymi wartościami (bez `url()`, wyrażeń i pozycjonowania). */
const mailStyle = (raw: string) => raw.split(';').map((rule) => {
  const colon = rule.indexOf(':');
  if (colon < 1) return '';
  const name = rule.slice(0, colon).trim().toLowerCase();
  const value = rule.slice(colon + 1).replace(/!important/gi, '').trim();
  const pattern = MAIL_STYLES[name];
  return pattern && value.length <= 80 && pattern.test(value) ? `${name}: ${value}` : '';
}).filter(Boolean).join('; ');

/**
 * Treść wiadomości z edytora na Macu: tylko znaczniki formatowania (akapity, listy, wcięcia, pogrubienie, kursywa, podkreślenie,
 * przekreślenie, linki, kolor i rozmiar tekstu) i bezpieczne style; skrypty, style, ramki, obrazy i formularze są usuwane,
 * niezamknięte znaczniki — domykane. Linki tylko `http(s)`, `mailto` i `tel`.
 */
export function sanitizeMailContentHtml(input: string) {
  const html = String(input || '');
  const tokens = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s>"'=/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;
  let output = '';
  let cursor = 0;
  let dropping: string | null = null;
  const open: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(html))) {
    if (!dropping) output += escapeMailText(html.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    if (match[0].startsWith('<!--')) continue;
    const tag = match[1].toLowerCase();
    const closing = match[0].startsWith('</');
    if (dropping) {
      if (closing && tag === dropping) dropping = null;
      continue;
    }
    if (MAIL_DROP_WITH_CONTENT.has(tag)) {
      if (!closing && !match[0].endsWith('/>')) dropping = tag;
      continue;
    }
    if (!MAIL_TAGS.has(tag)) continue;
    if (closing) {
      const index = open.lastIndexOf(tag);
      if (index === -1) continue;
      while (open.length > index) output += `</${open.pop()}>`;
      continue;
    }
    let attributes = '';
    const attributePattern = /([^\s>"'=/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let attribute: RegExpExecArray | null;
    while ((attribute = attributePattern.exec(match[2] || ''))) {
      const name = attribute[1].toLowerCase();
      const value = decodeAttribute(attribute[3] ?? attribute[4] ?? attribute[5] ?? '').trim();
      if (name === 'style') {
        const style = mailStyle(value);
        if (style) attributes += ` style="${escapeMailAttribute(style)}"`;
      } else if (name === 'href' && tag === 'a') {
        if (value.length <= 2000 && /^(?:https?:\/\/|mailto:|tel:)[^\s"'<>]+$/i.test(value)) attributes += ` href="${escapeMailAttribute(value)}"`;
      } else if (name === 'color' && tag === 'font' && MAIL_STYLES.color.test(value)) {
        attributes += ` color="${escapeMailAttribute(value)}"`;
      } else if (name === 'start' && tag === 'ol' && /^\d{1,4}$/.test(value)) {
        attributes += ` start="${value}"`;
      }
    }
    output += `<${tag}${attributes}>`;
    if (!MAIL_VOID.has(tag)) open.push(tag);
  }
  if (!dropping) output += escapeMailText(html.slice(cursor));
  while (open.length) output += `</${open.pop()}>`;
  return output.trim();
}

/** Stopka wybranej skrzynki do okna nowej wiadomości (na końcu treści, tak jak zobaczy ją odbiorca). */
export async function composeSignatureHtml(client: SupabaseClient, employeeId: string, accountId: string) {
  const signature = await buildCompanySignatureHtml({ client, employeeId, emailAccountId: accountId });
  return upgradeInsecureMedia(removeActiveEmailContent(signature.html || ''));
}

/** Ostateczny HTML wysyłki: treść, stopka i szablon firmy skrzynki nadawczej, cytat — jak `buildUnifiedEmailHtml`. */
export async function composeEmailHtml(client: SupabaseClient, opts: {
  employeeId: string;
  accountId: string;
  subject: string;
  text: string;
  /** Treść z edytora z formatowaniem (Mac); bez niej — `text` jako zwykły tekst. */
  html?: string;
  quotedHtml?: string;
}): Promise<string> {
  const signature = await buildCompanySignatureHtml({ client, employeeId: opts.employeeId, emailAccountId: opts.accountId });
  const result = await buildCompanyEmailBody({
    client,
    employeeId: opts.employeeId,
    emailAccountId: opts.accountId,
    content: typeof opts.html === 'string' && opts.html.trim() ? sanitizeMailContentHtml(opts.html) : plainTextToEmailHtml(opts.text),
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
