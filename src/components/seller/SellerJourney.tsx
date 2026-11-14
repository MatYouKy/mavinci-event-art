import type { ReactNode } from 'react';
import { SELLER_JOURNEY_ACTOR_LABELS, SELLER_JOURNEY_STAGES, type SellerJourney, type SellerJourneyTone, type SellerJourneyViewer } from '@/lib/seller/offerJourney';

const barTone: Record<SellerJourneyTone, string> = {
  action: 'bg-amber-300',
  waiting: 'bg-sky-300',
  success: 'bg-emerald-300',
  danger: 'bg-rose-300',
  neutral: 'bg-white/40',
};
const textTone: Record<SellerJourneyTone, string> = {
  action: 'text-amber-200',
  waiting: 'text-sky-200',
  success: 'text-emerald-200',
  danger: 'text-rose-200',
  neutral: 'text-white/60',
};

/**
 * Wspólna oś oferty w pięciu etapach (portal, CRM). Pod osią zawsze jedno zdanie „Teraz: kto, co”.
 * Źródło etapów i treści: src/lib/seller/offerJourney.ts.
 */
export default function SellerJourneyAxis({ journey, viewer = 'seller', action, compact = false }: {
  journey: SellerJourney;
  viewer?: SellerJourneyViewer;
  /** Jeden przycisk „co zrobić” pod zdaniem „Teraz”. */
  action?: ReactNode;
  compact?: boolean;
}) {
  const actor = SELLER_JOURNEY_ACTOR_LABELS[journey.actor][viewer];
  return <section aria-label="Etap oferty" className={`rounded-xl bg-white/[0.035] ${compact ? 'p-3' : 'p-4'}`}>
    <ol className="grid grid-cols-5 gap-1.5">
      {SELLER_JOURNEY_STAGES.map((stage, index) => {
        const current = index === journey.index;
        const done = index < journey.index;
        return <li key={stage.key} aria-current={current ? 'step' : undefined} title={stage.hint} className="min-w-0">
          <span aria-hidden="true" className={`block h-1.5 rounded-full ${current ? barTone[journey.tone] : done ? 'bg-emerald-300/50' : 'bg-white/10'}`} />
          <span className={`mt-2 block truncate text-[11px] sm:text-xs ${current ? textTone[journey.tone] : done ? 'text-emerald-200/75' : 'text-white/40'}`}>
            <span className="sr-only">{done ? 'Za nami: ' : current ? 'Teraz: ' : 'Przed nami: '}</span>{stage.label}
          </span>
        </li>;
      })}
    </ol>
    <div className={`${compact ? 'mt-2' : 'mt-3'} space-y-1`}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className={`font-medium ${textTone[journey.tone]}`}>{journey.state}</span>
        {journey.actor !== 'none' && <span className="rounded-md bg-white/[0.05] px-2 py-0.5 text-[11px] text-white/60">Teraz działa: {actor}</span>}
      </p>
      <p className="text-sm leading-6 text-white/70">{journey.now}</p>
    </div>
    {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
  </section>;
}

/** Mała oś do list: pięć kresek i stan. */
export function SellerJourneyDots({ journey }: { journey: SellerJourney }) {
  return <span className="inline-flex items-center gap-1" aria-label={`Etap ${journey.index + 1} z 5: ${journey.stageLabel} — ${journey.state}`} role="img">
    {SELLER_JOURNEY_STAGES.map((stage, index) => <span key={stage.key} aria-hidden="true"
      className={`h-1.5 w-4 rounded-full ${index === journey.index ? barTone[journey.tone] : index < journey.index ? 'bg-emerald-300/50' : 'bg-white/10'}`} />)}
  </span>;
}

export const sellerJourneyBadgeClass: Record<SellerJourneyTone, string> = {
  action: 'bg-amber-300/10 text-amber-200',
  waiting: 'bg-sky-300/10 text-sky-200',
  success: 'bg-emerald-300/10 text-emerald-200',
  danger: 'bg-rose-300/10 text-rose-200',
  neutral: 'bg-white/5 text-white/60',
};
