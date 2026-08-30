'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';

export default function CRMError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const message = String(error?.message || '');
    console.error('CRM route error', {
      digest: error?.digest,
      transientDatabaseError: message.includes('522') || message.includes('Connection timed out'),
    });
  }, [error]);

  return (
    <div className="flex min-h-[55vh] items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-xl border border-amber-400/20 bg-[#1c1f33] p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-amber-300" />
        <h1 className="mt-4 text-xl font-light text-[#e5e4e2]">Nie udało się pobrać danych</h1>
        <p className="mt-2 text-sm leading-6 text-[#e5e4e2]/55">
          Połączenie z bazą danych mogło zostać chwilowo przerwane. Zapisane dane nie zostały usunięte.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
        >
          <RefreshCw className="h-4 w-4" />
          Spróbuj ponownie
        </button>
      </div>
    </div>
  );
}
