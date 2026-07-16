'use client';

import { useState } from 'react';
import { Play, Loader as Loader2, FileCheck, Circle, RefreshCw } from 'lucide-react';

type ImportSource = 'all' | 'bzp' | 'ted' | 'baza_konkurencyjnosci';
interface ImportResult {
  success: boolean;
  results?: Record<
    string,
    { success: boolean; count: number; new: number; updated: number; matched: number; error?: string }
  >;
  error?: string;
}

export default function ImportControls({ onImportComplete }: { onImportComplete: () => void }) {
  const [importing, setImporting] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const runImport = async (source: ImportSource = 'all') => {
    setImporting(true);
    setResult(null);

    try {
      const url =
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fetch-tenders` +
        (source !== 'all' ? `?source=${source}` : '');

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      const data: ImportResult = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Blad importu');
      }

      setResult(data);
      onImportComplete();
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setImporting(false);
    }
  };

  const runRecalculate = async () => {
    setRecalculating(true);
    try {
      const response = await fetch('/bridge/tenders/recalculate', {
        method: 'POST',
      });
      const data = await response.json();
      if (data.success) {
        onImportComplete();
      }
    } catch {
      // silent
    } finally {
      setRecalculating(false);
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

            <h2 className="text-lg font-medium text-[#e5e4e2]">Importowanie przetargow</h2>

            <p className="mt-2 text-sm leading-relaxed text-[#e5e4e2]/50">
              Pobieram dane z BZP, TED i Bazy Konkurencyjnosci. Filtruje po kodach CPV. Prosze nie zamykac okna.
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
            Wszystkie zrodla
          </button>

          {[
            { key: 'bzp' as const, label: 'BZP' },
            { key: 'ted' as const, label: 'TED' },
            { key: 'baza_konkurencyjnosci' as const, label: 'Baza Konkurencyjnosci' },
          ].map((src) => (
            <button
              key={src.key}
              onClick={() => runImport(src.key)}
              disabled={importing}
              className="flex items-center gap-1.5 rounded-lg border border-[#d3bb73]/20 px-3 py-1.5 text-xs text-[#e5e4e2]/70 transition-colors hover:border-[#d3bb73]/40 hover:text-[#e5e4e2] disabled:opacity-50"
            >
              {src.label}
            </button>
          ))}

          <button
            onClick={runRecalculate}
            disabled={recalculating || importing}
            title="Przelicz dopasowanie wszystkich przetargow"
            className="flex items-center gap-1.5 rounded-lg border border-[#d3bb73]/20 px-3 py-1.5 text-xs text-[#e5e4e2]/70 transition-colors hover:border-[#d3bb73]/40 hover:text-[#e5e4e2] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${recalculating ? 'animate-spin' : ''}`} />
            Przelicz
          </button>

          {result && (
            <div className="ml-auto flex items-center gap-2">
              {result.success ? (
                <span className="flex items-center gap-1.5 text-xs text-green-400">
                  <FileCheck className="h-3.5 w-3.5" />
                  Import zakonczony
                  {result.results && (
                    <span className="text-[#e5e4e2]/40">
                      ({Object.values(result.results).reduce((s, r) => s + (r.new || 0), 0)} nowych,{' '}
                      {Object.values(result.results).reduce((s, r) => s + (r.matched || 0), 0)}{' '}
                      dopasowanych)
                    </span>
                  )}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-red-400">
                  <Circle className="h-3.5 w-3.5" />
                  Blad: {result.error}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
