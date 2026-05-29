'use client';

import { useState } from 'react';
import { Play, Loader as Loader2, CircleCheck as CheckCircle2, Circle as XCircle } from 'lucide-react';

interface ImportResult {
  success: boolean;
  results?: Record<string, { success: boolean; count: number; new: number; updated: number; error?: string }>;
  error?: string;
}

export default function ImportControls({ onImportComplete }: { onImportComplete: () => void }) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const runImport = async (source?: string) => {
    setImporting(true);
    setResult(null);

    try {
      const url = source
        ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fetch-tenders?source=${source}`
        : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fetch-tenders`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      setResult(data);
      onImportComplete();
    } catch (err) {
      setResult({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="mb-6 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-[#e5e4e2]/70">Import danych:</span>

        <button
          onClick={() => runImport()}
          disabled={importing}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-xs font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
        >
          {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Wszystkie źródła
        </button>

        {['bzp', 'ted', 'baza_konkurencyjnosci'].map((src) => (
          <button
            key={src}
            onClick={() => runImport(src)}
            disabled={importing}
            className="flex items-center gap-1.5 rounded-lg border border-[#d3bb73]/20 px-3 py-1.5 text-xs text-[#e5e4e2]/70 transition-colors hover:border-[#d3bb73]/40 hover:text-[#e5e4e2] disabled:opacity-50"
          >
            {src === 'bzp' ? 'BZP' : src === 'ted' ? 'TED' : 'Baza Konkurencyjności'}
          </button>
        ))}

        {result && (
          <div className="ml-auto flex items-center gap-2">
            {result.success ? (
              <span className="flex items-center gap-1.5 text-xs text-green-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Import zakończony
                {result.results && (
                  <span className="text-[#e5e4e2]/40">
                    ({Object.values(result.results).reduce((s, r) => s + r.new, 0)} nowych,{' '}
                    {Object.values(result.results).reduce((s, r) => s + r.updated, 0)} zaktualizowanych)
                  </span>
                )}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-red-400">
                <XCircle className="h-3.5 w-3.5" />
                Błąd: {result.error}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
