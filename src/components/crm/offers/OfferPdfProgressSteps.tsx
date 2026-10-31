import { Check, Loader2, CircleAlert } from 'lucide-react';
import { OFFER_PDF_STEPS, type OfferPdfStep, type OfferPdfFailure } from '@/lib/offer-pdf/progress';

export default function OfferPdfProgressSteps({ current, failure }: { current: OfferPdfStep; failure?: OfferPdfFailure | null }) {
  const active = OFFER_PDF_STEPS.findIndex(step => step.id === (failure?.step || current));
  return <ol aria-label="Etapy generowania PDF" className="w-full space-y-1 text-left">
    {OFFER_PDF_STEPS.map((step, index) => {
      const done = index < active;
      const running = index === active;
      const failed = running && !!failure;
      return <li key={step.id} aria-current={running ? 'step' : undefined}
        className={`rounded-lg px-3 py-2 text-sm ${failed ? 'bg-red-400/10 text-red-200' : running ? 'bg-white/5 text-[#d3bb73]' : done ? 'text-[#e5e4e2]/80' : 'text-[#e5e4e2]/40'}`}>
        <div className="flex items-center gap-3">
          {failed ? <CircleAlert aria-hidden="true" className="h-4 w-4 shrink-0" /> : done ? <Check aria-hidden="true" className="h-4 w-4 shrink-0" /> : running ? <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" /> : <span aria-hidden="true" className="w-4 shrink-0 text-center text-xs">{index + 1}</span>}
          <span>{step.label}<span className="sr-only">{failed ? ' — błąd' : done ? ' — zakończono' : running ? ' — w trakcie' : ' — nie rozpoczęto'}</span></span>
        </div>
        {failed && failure && <div role="alert" className="ml-7 mt-2 select-text space-y-1 break-words text-xs leading-relaxed">
          {failure.context && <p className="text-[#e5e4e2]/60">{failure.context}</p>}
          <p>{failure.message}</p>
          {failure.code && <p>Kod błędu: {failure.code}</p>}
          {failure.status && <p>Odpowiedź serwera: HTTP {failure.status}</p>}
          {failure.requestId && <p className="break-all text-[#e5e4e2]/60">Identyfikator zgłoszenia: {failure.requestId}</p>}
        </div>}
      </li>;
    })}
  </ol>;
}
