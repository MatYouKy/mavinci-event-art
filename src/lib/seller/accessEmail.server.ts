import 'server-only';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { PASSWORD_ACCESS_ORIGIN } from '@/lib/passwordAccess';

type SellerAccessEmailInput = {
  to: string;
  recipientName?: string | null;
  actionUrl: string;
  isNewAccount: boolean;
};

type PasswordAccessEmailInput = SellerAccessEmailInput & {
  portal: 'crm' | 'seller';
};

const EMAIL_LOGO_CID = 'mavinci-account-logo@mavinci.pl';

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const buildEmailHtml = ({
  to,
  recipientName,
  actionUrl,
  isNewAccount,
  portal,
}: PasswordAccessEmailInput) => {
  const trimmedName = recipientName?.trim();
  const greeting = trimmedName ? `Witaj, ${escapeHtml(trimmedName)}` : 'Dzień dobry';
  const safeEmail = escapeHtml(to);
  const safeActionUrl = escapeHtml(actionUrl);
  const safeLogoUrl = `cid:${EMAIL_LOGO_CID}`;
  const portalLabel = portal === 'seller' ? 'PORTAL SPRZEDAWCY' : 'MAVINCI CRM';
  const accountLabel = portal === 'seller' ? 'portalu sprzedawcy MAVINCI' : 'systemu MAVINCI CRM';
  const heading = isNewAccount ? 'DOSTĘP DO PORTALU SPRZEDAWCY' : 'USTAW NOWE HASŁO';
  const introduction = isNewAccount
    ? 'Twoje konto w portalu sprzedawcy MAVINCI jest gotowe. Ustaw własne hasło, aby rozpocząć pracę z ofertami.'
    : `Przygotowaliśmy bezpieczny link, za pomocą którego możesz ustawić nowe hasło do ${accountLabel}.`;

  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>${heading}</title>
    <style>
      :root { color-scheme: light dark; supported-color-schemes: light dark; }
      .email-action, .email-action:visited, .email-action span { color:#ffffff !important; -webkit-text-fill-color:#ffffff !important; }
      .email-header { background-color:#290812 !important; background-image:linear-gradient(#290812,#290812) !important; }
      .email-header-label { color:#d3bb73 !important; }
      @media (prefers-color-scheme: dark) {
        .email-background { background-color:#120b10 !important; }
        .email-card, .email-content { background-color:#24131c !important; }
        .email-panel { background-color:#321d28 !important; }
        .email-title, .email-strong { color:#f7f0ed !important; }
        .email-copy { color:#e2d8de !important; }
        .email-muted { color:#c6b7c0 !important; }
        .email-accent, .email-link { color:#e8d391 !important; }
        .email-action-cell, .email-action { background-color:#681a38 !important; }
      }
      [data-ogsc] .email-background { background-color:#120b10 !important; }
      [data-ogsc] .email-card, [data-ogsc] .email-content { background-color:#24131c !important; }
      [data-ogsc] .email-panel { background-color:#321d28 !important; }
      [data-ogsc] .email-title, [data-ogsc] .email-strong { color:#f7f0ed !important; }
      [data-ogsc] .email-copy { color:#e2d8de !important; }
      [data-ogsc] .email-muted { color:#c6b7c0 !important; }
      [data-ogsc] .email-accent, [data-ogsc] .email-link { color:#e8d391 !important; }
      [data-ogsc] .email-action-cell, [data-ogsc] .email-action { background-color:#681a38 !important; }
      @media screen and (max-width:480px) {
        .email-content { padding-left:24px !important; padding-right:24px !important; }
      }
    </style>
  </head>
  <body class="email-background" style="margin:0;padding:0;background-color:#f3efeb;color:#211a1f;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Ustaw nowe hasło do ${accountLabel}.
    </div>
    <table class="email-background" role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f3efeb" style="width:100%;border-collapse:collapse;background-color:#f3efeb;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table class="email-card" role="presentation" width="620" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="width:100%;max-width:620px;border-collapse:separate;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 12px 40px rgba(31,8,18,.10);">
            <tr>
              <td class="email-header" align="center" bgcolor="#290812" style="padding:32px 28px 27px;background-color:#290812;background-image:linear-gradient(#290812,#290812);">
                <a href="https://mavinci.pl" style="display:inline-block;text-decoration:none;">
                  <img src="${safeLogoUrl}" width="230" height="53" border="0" alt="MAVINCI" style="display:block;width:230px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;color:#ffffff;font-size:22px;font-weight:700;">
                </a>
                <div class="email-header-label" style="margin-top:15px;color:#d3bb73;font-size:11px;line-height:16px;letter-spacing:2.4px;text-transform:uppercase;">${portalLabel}</div>
              </td>
            </tr>
            <tr>
              <td class="email-content" bgcolor="#ffffff" style="padding:42px 42px 24px;background-color:#ffffff;">
                <p class="email-accent" style="margin:0 0 12px;color:#806522;font-size:12px;line-height:18px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;">${heading}</p>
                <h1 class="email-title" style="margin:0 0 22px;color:#241c22;font-size:29px;line-height:36px;font-weight:600;">${greeting}</h1>
                <p class="email-copy" style="margin:0 0 18px;color:#49404a;font-size:16px;line-height:25px;">${introduction}</p>
                <p class="email-muted" style="margin:0;color:#665b65;font-size:14px;line-height:22px;">Konto: <strong class="email-strong" style="color:#312b31;">${safeEmail}</strong></p>
              </td>
            </tr>
            <tr>
              <td class="email-content" align="center" bgcolor="#ffffff" style="padding:8px 42px 34px;background-color:#ffffff;">
                <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:separate;">
                  <tr>
                    <td class="email-action-cell" align="center" bgcolor="#681a38" style="border-radius:10px;background-color:#681a38;">
                      <a class="email-action" href="${safeActionUrl}" style="display:inline-block;padding:16px 28px;background-color:#681a38;color:#ffffff !important;-webkit-text-fill-color:#ffffff;font-size:15px;line-height:22px;font-weight:700;text-decoration:none;border-radius:10px;"><span style="color:#ffffff !important;-webkit-text-fill-color:#ffffff;">USTAW NOWE HASŁO</span></a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="email-content" bgcolor="#ffffff" style="padding:0 42px 38px;background-color:#ffffff;">
                <table class="email-panel" role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f7f5f2" style="width:100%;border-collapse:separate;background-color:#f7f5f2;border-radius:12px;">
                  <tr>
                    <td class="email-muted" style="padding:18px 20px;color:#665b65;font-size:12px;line-height:19px;">
                      Jeżeli przycisk nie działa, skopiuj ten adres i wklej go do przeglądarki:<br>
                      <a class="email-link" href="${safeActionUrl}" style="color:#785c16;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${safeActionUrl}</a>
                    </td>
                  </tr>
                </table>
                <p class="email-muted" style="margin:18px 0 0;color:#665b65;font-size:12px;line-height:19px;">Ze względów bezpieczeństwa link jest jednorazowy i może wygasnąć. Jeżeli nie oczekujesz tej wiadomości, możesz ją zignorować.</p>
              </td>
            </tr>
            <tr>
              <td class="email-header" align="center" bgcolor="#290812" style="padding:22px 30px;background-color:#290812;background-image:linear-gradient(#290812,#290812);color:#e2d8de;font-size:11px;line-height:18px;">
                MAVINCI · SZTUKA TWORZENIA EVENTÓW<br>
                <a href="https://mavinci.pl" style="color:#d3bb73;text-decoration:none;">www.mavinci.pl</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

export async function sendPasswordAccessEmail(input: PasswordAccessEmailInput) {
  if (new URL(input.actionUrl).origin !== PASSWORD_ACCESS_ORIGIN) {
    throw new Error('Link dostępowy musi prowadzić do https://mavinci.pl.');
  }
  // To samo aktualne logo co w nawigacji WWW, jako PNG MIME/Content-ID.
  // Nie wymaga pobierania obrazu z localhost ani z publicznego adresu serwera.
  const logo = await readFile(join(process.cwd(), 'public', 'logo.png'));
  const admin = createSupabaseAdminClient();
  const { data: systemEmail, error: systemEmailError } = await admin
    .from('employee_email_accounts')
    .select('id')
    .eq('is_system_account', true)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (systemEmailError || !systemEmail) {
    throw new Error('Brak aktywnego systemowego konta e-mail w ustawieniach CRM.');
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Brak konfiguracji wysyłki wiadomości systemowych.');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
    body: JSON.stringify({
      to: input.to,
      subject: input.isNewAccount
        ? 'Dostęp do portalu sprzedawcy MAVINCI'
        : input.portal === 'seller'
          ? 'Ustaw nowe hasło do portalu sprzedawcy MAVINCI'
          : 'Ustaw nowe hasło do MAVINCI CRM',
      body: buildEmailHtml(input),
      attachments: [{
        filename: 'mavinci-logo.png',
        content: logo.toString('base64'),
        contentType: 'image/png',
        contentDisposition: 'inline',
        cid: EMAIL_LOGO_CID,
      }],
      emailAccountId: systemEmail.id,
    }),
  });

  if (!response.ok) {
    let message = 'Nie udało się wysłać wiadomości e-mail.';
    try {
      const result = await response.json();
      message = result?.error || message;
    } catch {
      // Odpowiedź serwera pocztowego nie zawsze jest w formacie JSON.
    }
    throw new Error(message);
  }
}

export async function sendSellerAccessEmail(input: SellerAccessEmailInput) {
  return sendPasswordAccessEmail({ ...input, portal: 'seller' });
}
