'use client';

import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2 } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { convertProductImages, productImagesPending, type ProductImagesConversion } from '@/components/crm/materials/materialsApi';

/*
 * Katalog produktów: starsze zdjęcia produktów, wariantów i pakietów zapisane jako JPG/PNG zamieniamy jednym przyciskiem na lekkie
 * WebP — porcjami po kilka zdjęć (`convertOfferImages` na serwerze: nowy plik obok starego, zmiana ścieżki i kadrów). Stare pliki
 * zostają w magazynie, bo mogą ich używać wcześniejsze broszury. Pasek widzą tylko osoby, które mogą zmieniać produkty.
 * Mac — pasek w `ProductsView.swift`.
 */

/** „1 zdjęcie”, „3 zdjęcia”, „5 zdjęć”. */
export function photosText(count: number) {
  const tens = count % 100;
  const ones = count % 10;
  if (count === 1) return '1 zdjęcie';
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return `${count} zdjęcia`;
  return `${count} zdjęć`;
}

export default function ProductImagesWebpBanner() {
  const { showSnackbar } = useSnackbar();
  const [pending, setPending] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState<ProductImagesConversion['failed']>([]);
  const running = useRef(false);

  const refresh = async () => {
    const result = await productImagesPending();
    setPending(result.canEdit ? result.count : 0);
  };
  useEffect(() => {
    let active = true;
    productImagesPending()
      .then((result) => { if (active) setPending(result.canEdit ? result.count : 0); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const convert = async () => {
    if (running.current || !pending) return;
    running.current = true;
    const skip: string[] = [];
    const problems: ProductImagesConversion['failed'] = [];
    let done = 0;
    let total = pending;
    setFailed([]);
    setProgress({ done, total });
    try {
      // Porcje do skutku; zdjęcia z błędem pomijamy w kolejnych porcjach (lista pod paskiem).
      for (let round = 0; round < 500; round += 1) {
        const result = await convertProductImages(skip);
        done += result.converted;
        result.failed.forEach((item) => { skip.push(item.key); problems.push(item); });
        total = Math.max(total, done + problems.length + result.remaining);
        setProgress({ done, total });
        if (!result.remaining || (!result.converted && !result.failed.length)) break;
      }
      setFailed(problems);
      if (problems.length) showSnackbar(`Zamieniono ${photosText(done)} na WebP. Nie udało się zamienić: ${problems.length}.`, 'warning');
      else showSnackbar(`Zamieniono ${photosText(done)} na WebP.`, 'success');
    } catch (error) {
      setFailed(problems);
      showSnackbar(error instanceof Error ? error.message : 'Nie udało się zamienić zdjęć na WebP. Spróbuj ponownie.', 'error');
    } finally {
      running.current = false;
      setProgress(null);
      await refresh().catch(() => undefined);
    }
  };

  if (!pending && !failed.length && !progress) return null;
  const percent = progress && progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
  return (
    <div className="mb-5 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 px-4 py-3 text-sm text-[#e5e4e2]/80" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <ImageIcon className="h-4 w-4 shrink-0 text-[#d3bb73]" />
        {progress ? (
          <span className="min-w-0 flex-1">Zamieniam zdjęcia na WebP… {progress.done} z {progress.total}</span>
        ) : pending ? (
          <span className="min-w-0 flex-1">
            W katalogu {pending === 1 ? 'jest' : pending % 10 >= 2 && pending % 10 <= 4 && (pending % 100 < 12 || pending % 100 > 14) ? 'są' : 'jest'} {photosText(pending)} w formacie JPG/PNG.
            Zamień je na lekkie WebP — oferty, broszury i strona wczytają się szybciej. Kadry zostaną bez zmian.
          </span>
        ) : (
          <span className="min-w-0 flex-1">Wszystkie pozostałe zdjęcia są już w WebP.</span>
        )}
        {pending > 0 && (
          <button type="button" disabled={Boolean(progress)} onClick={() => void convert()}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-sm font-medium text-[#1c1f33] disabled:opacity-50">
            {progress && <Loader2 className="h-4 w-4 animate-spin" />}{progress ? 'Zamieniam…' : 'Zamień na WebP'}
          </button>
        )}
      </div>
      {progress && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <div className="h-full bg-[#d3bb73] transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      )}
      {failed.length > 0 && !progress && (
        <div className="mt-2 text-xs text-red-200/90">
          <p>Nie udało się zamienić ({failed.length}) — otwórz produkt i wgraj zdjęcie ponownie:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {failed.slice(0, 12).map((item) => <li key={item.key}>{item.label}: {item.error}</li>)}
            {failed.length > 12 && <li>… i {failed.length - 12} więcej</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
