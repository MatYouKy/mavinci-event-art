import 'server-only';
import type { Page } from 'playwright';

const hostOf = (value?: string | null) => {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
};

/**
 * Renderer PDF pobiera tylko zasoby osadzone (data:, blob:) oraz pliki z zaufanych hostów:
 * Supabase Storage, własna domena aplikacji i Google Fonts. Blokuje zapytania do sieci
 * wewnętrznej i dowolnych adresów podanych w treści dokumentu.
 */
export async function restrictPageNetwork(page: Page, extraOrigins: Array<string | null | undefined> = []) {
  const allowed = new Set(
    [
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SITE_URL,
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.NEXT_PUBLIC_FRONTEND_URL,
      'https://fonts.googleapis.com',
      'https://fonts.gstatic.com',
      ...extraOrigins,
    ]
      .map(hostOf)
      .filter((host): host is string => Boolean(host)),
  );

  await page.route('**/*', (route) => {
    const target = route.request().url();
    if (/^(data|blob|about):/i.test(target)) return route.continue();
    try {
      const parsed = new URL(target);
      if (parsed.protocol === 'https:' && allowed.has(parsed.host)) return route.continue();
    } catch {
      // nieprawidłowy adres — blokujemy
    }
    return route.abort();
  });
}
