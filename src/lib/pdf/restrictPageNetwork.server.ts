import 'server-only';
import type { Page } from 'playwright';
import { trustedPrintHosts } from '@/lib/print/printJob.server';

/**
 * Renderer PDF pobiera tylko zasoby osadzone (data:, blob:) oraz pliki z zaufanych hostów:
 * Supabase Storage, własna domena aplikacji i Google Fonts. Blokuje zapytania do sieci
 * wewnętrznej i dowolnych adresów podanych w treści dokumentu.
 */
export async function restrictPageNetwork(page: Page, extraOrigins: Array<string | null | undefined> = []) {
  const allowed = new Set(trustedPrintHosts(extraOrigins));

  await page.route('**/*', (route) => {
    const target = route.request().url();
    if (/^(data|blob|about):/i.test(target)) return route.continue();
    try {
      const parsed = new URL(target);
      // Tylko własne hosty z konfiguracji (http dopuszczalny dla lokalnego środowiska).
      if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && allowed.has(parsed.host)) {
        return route.continue();
      }
    } catch {
      // nieprawidłowy adres — blokujemy
    }
    return route.abort();
  });
}
