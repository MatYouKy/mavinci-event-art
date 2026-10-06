import { Loader2 } from 'lucide-react';

export default function CRMLoading() {
  return (
    <div className="flex min-h-[45vh] flex-col items-center justify-center gap-3 p-6 text-center" role="status" aria-live="polite">
      <Loader2 className="h-7 w-7 animate-spin text-[#d3bb73]" aria-hidden="true" />
      <p className="text-sm text-[#e5e4e2]/70">Ładowanie danych CRM…</p>
      <p className="text-xs text-[#e5e4e2]/45">Przy wolniejszym połączeniu może to potrwać chwilę.</p>
    </div>
  );
}
