'use client';

import { useState } from 'react';
import { Play, Loader as Loader2, FileCheck, Circle } from 'lucide-react';

type ImportSource = 'all' | 'bzp' | 'ted' | 'baza_konkurencyjnosci';
interface ImportResult {
  success: boolean;
  results?: Record<
    string,
    { success: boolean; count: number; new: number; updated: number; error?: string }
  >;
  error?: string;
}

export default function ImportControls({ onImportComplete }: { onImportComplete: () => void }) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const runImport = async (source: ImportSource = 'all') => {
    setImporting(true);
    setResult(null);

    try {
      const cpvLimit = 3;
      const maxCpv = 54;

      const mergedResult: ImportResult = {
        success: true,
        results: {},
      };

      const importBzp = async () => {
        for (let cpvOffset = 0; cpvOffset < maxCpv; cpvOffset += cpvLimit) {
          const url =
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fetch-tenders` +
            `?source=bzp` +
            `&cpvOffset=${cpvOffset}` +
            `&cpvLimit=${cpvLimit}`;

          const response = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
          });

          const data: ImportResult = await response.json();

          if (!response.ok || !data.success) {
            throw new Error(data.error || `Błąd importu BZP offset ${cpvOffset}`);
          }

          const batch = data.results?.bzp;

          if (batch) {
            mergedResult.results!.bzp ??= {
              success: true,
              count: 0,
              new: 0,
              updated: 0,
            };

            mergedResult.results!.bzp.count += batch.count || 0;
            mergedResult.results!.bzp.new += batch.new || 0;
            mergedResult.results!.bzp.updated += batch.updated || 0;
          }

          onImportComplete();
        }
      };

      const importTed = async () => {
        for (let cpvOffset = 0; cpvOffset < maxCpv; cpvOffset += cpvLimit) {
          const url =
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fetch-tenders` +
            `?source=ted` +
            `&cpvOffset=${cpvOffset}` +
            `&cpvLimit=${cpvLimit}`;

          const response = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
          });

          const data: ImportResult = await response.json();

          if (!response.ok || !data.success) {
            throw new Error(data.error || `Błąd importu TED offset ${cpvOffset}`);
          }

          const batch = data.results?.ted;

          if (batch) {
            mergedResult.results!.ted ??= {
              success: true,
              count: 0,
              new: 0,
              updated: 0,
            };

            mergedResult.results!.ted.count += batch.count || 0;
            mergedResult.results!.ted.new += batch.new || 0;
            mergedResult.results!.ted.updated += batch.updated || 0;
          }

          onImportComplete();
        }
      };

      if (source === 'all' || source === 'bzp') {
        await importBzp();
      }

      if (source === 'all' || source === 'ted') {
        await importTed();
      }

      setResult(mergedResult);
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      {importing && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10">
              <Loader2 className="h-7 w-7 animate-spin text-[#d3bb73]" />
            </div>

            <h2 className="text-lg font-medium text-[#e5e4e2]">Importowanie przetargów</h2>

            <p className="mt-2 text-sm leading-relaxed text-[#e5e4e2]/50">
              Pobieram dane z BZP i TED oraz zapisuję nowe rekordy w bazie. Proszę nie zamykać okna.
            </p>
          </div>
        </div>
      )}

      <div className="mb-6 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-[#e5e4e2]/70">Import danych:</span>

          <button
            onClick={() => runImport()}
            disabled={importing}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-xs font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            BZP + TED
          </button>

          {[
            { key: 'bzp' as const, label: 'BZP', disabled: false },
            { key: 'ted' as const, label: 'TED', disabled: false },
            {
              key: 'baza_konkurencyjnosci',
              label: 'Baza Konkurencyjności',
              disabled: true,
              title: 'Wymaga konfiguracji API',
            },
          ].map((src) => (
            <button
              key={src.key}
              onClick={() => {
                if (src.key === 'bzp' || src.key === 'ted') {
                  runImport(src.key);
                }
              }}
              disabled={importing || src.disabled}
              title={src.title}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                src.disabled
                  ? 'cursor-not-allowed border-[#d3bb73]/10 text-[#e5e4e2]/30'
                  : 'border-[#d3bb73]/20 text-[#e5e4e2]/70 hover:border-[#d3bb73]/40 hover:text-[#e5e4e2]'
              }`}
            >
              {src.label}
            </button>
          ))}

          {result && (
            <div className="ml-auto flex items-center gap-2">
              {result.success ? (
                <span className="flex items-center gap-1.5 text-xs text-green-400">
                  <FileCheck className="h-3.5 w-3.5" />
                  Import zakończony
                  {result.results && (
                    <span className="text-[#e5e4e2]/40">
                      ({Object.values(result.results).reduce((s, r) => s + r.new, 0)} nowych,{' '}
                      {Object.values(result.results).reduce((s, r) => s + r.updated, 0)}{' '}
                      zaktualizowanych)
                    </span>
                  )}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-red-400">
                  <Circle className="h-3.5 w-3.5" />
                  Błąd: {result.error}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
