'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function CRMError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [retrying, startTransition] = useTransition();
  useEffect(() => {
    const message = String(error?.message || '');
    console.error('CRM route error', {
      digest: error?.digest,
      transientDatabaseError: message.includes('522') || message.includes('Connection timed out'),
    });
  }, [error]);

  const retry = () => {
    startTransition(() => {
      // reset alone can render the same failed Server Component payload again.
      router.refresh();
      reset();
    });
  };

  return (
    <div className="flex min-h-[55vh] items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-xl border border-white/5 bg-[#1c1f33] p-6 text-center" aria-busy={retrying}>
        <AlertTriangle className="mx-auto h-8 w-8 text-amber-300" />
        <h1 className="mt-4 text-xl font-light text-[#e5e4e2]">Nie udało się pobrać danych</h1>
        <p className="mt-2 text-sm leading-6 text-[#e5e4e2]/55">
          Połączenie z bazą danych mogło zostać chwilowo przerwane. Zapisane dane nie zostały usunięte.
        </p>
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
          {retrying ? 'Ponowne pobieranie…' : 'Spróbuj ponownie'}
        </button>
      </div>
    </div>
  );
}
