'use client';
import { supabase } from '@/lib/supabase/browser';
export type ProductLanguageDocument = { fields: Array<{ key: string; label: string; source: string; target: string; limit?: number }>; revision: number; version: number };
export async function requestProductEnglish(productId: string, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeoutMs = body.action === 'generate' ? 180_000 : 45_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Przekroczono czas oczekiwania na odpowiedź. Serwer może nadal kończyć operację. Spróbuj ponownie za chwilę — gotowe tłumaczenia zostaną wykorzystane.'));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const { data, error } = await supabase.functions.invoke('translate-product', {
        body: { ...body, productId }, signal: controller.signal,
      });
      let message = data?.error;
      if (error && !message) { try { message = (await error.context?.json())?.error; } catch { /* use fallback */ } }
      if (error || message) throw new Error(message || 'Nie udało się połączyć z usługą tłumaczenia. Sprawdź połączenie i spróbuj ponownie.');
      if (!data || !Array.isArray(data.fields) || typeof data.revision !== 'number' || typeof data.version !== 'number') {
        throw new Error('Usługa tłumaczenia zwróciła nieprawidłową odpowiedź. Spróbuj ponownie.');
      }
      return data as ProductLanguageDocument;
    })()]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
/** Compact control placed beside the page actions; content keeps its existing layout. */
export default function ProductLanguageSwitch({ language, disabled, englishDisabled, label = 'Język treści produktu', onChange }: {
  language: 'pl' | 'en'; disabled?: boolean; englishDisabled?: boolean; label?: string; onChange: (value: 'pl' | 'en') => void;
}) {
  return <div role="group" aria-label={label} className="flex shrink-0 gap-1 rounded-lg bg-black/10 p-1">
    {(['pl', 'en'] as const).map(value => <button key={value} type="button" aria-pressed={language === value}
      disabled={disabled || (value === 'en' && englishDisabled)} onClick={() => onChange(value)} title={value === 'pl' ? 'Polska treść produktu' : 'Angielska treść produktu'}
      className={`rounded-md px-3 py-2 text-sm disabled:opacity-40 ${language === value ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-white/60 hover:bg-white/5'}`}>{value.toUpperCase()}</button>)}
  </div>;
}
