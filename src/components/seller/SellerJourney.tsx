import type { SellerDeliveryState } from '@/lib/seller/delivery';
import { deliveryStage } from '@/lib/seller/delivery';

export default function SellerJourney({ state, submitted = false, showCommission = false }: {
  state: Pick<SellerDeliveryState, 'realization' | 'review' | 'source_key'>;
  submitted?: boolean;
  /** Only when MAVINCI revealed commissions for the offer's brand. */
  showCommission?: boolean;
}) {
  const steps = ['Oferta i klient', 'Potwierdzenie opiekuna', 'Przygotowanie', showCommission ? 'Realizacja i rozliczenie' : 'Realizacja'];
  const event = deliveryStage(state.realization?.event_status);
  const accepted = state.realization?.stage === 'awaiting_crm_confirmation' || state.realization?.offer_status === 'accepted';
  const review = state.review?.source_key === state.source_key ? state.review : undefined;
  const index = event.index >= 4 ? 3 : event.index > 0 || state.realization?.stage === 'confirmed' ? 2
    : accepted || submitted || review?.status === 'pending' || review?.status === 'approved' ? 1 : 0;
  const interrupted = event.cancelled || state.realization?.stage === 'cancelled' || event.index === -1;
  const detail = interrupted
    ? 'Sprawa jest wstrzymana lub anulowana. Historia i rozmowa pozostają dostępne.'
    : index === 0 && review?.status === 'changes_requested' ? 'Opiekun prosi o poprawki. Po ich zapisaniu odpowiedz na uwagi w sekcji powyżej i przekaż aktualny PDF do ponownej weryfikacji.'
    : index === 0 && review?.status === 'rejected' ? 'Ta wersja nie została zaakceptowana. Po poprawkach lub wyjaśnieniu uwag odpowiedz opiekunowi i przekaż ofertę do ponownej weryfikacji.'
    : index === 0 ? 'Przedstaw ofertę klientowi. Po jego zgodzie przekaż aktualny PDF do opiekuna; na pytania jest wspólna rozmowa.'
    : index === 1 ? 'Teraz działa opiekun. Akceptacja oferty i ostateczne potwierdzenie wydarzenia to osobne decyzje. Nie wysyłaj oferty ponownie.'
    : index === 2 ? 'Realizacja potwierdzona. Teraz uzgadniamy montaż, demontaż, materiały i osoby kontaktowe.'
    : event.closed ? (showCommission ? 'Wydarzenie zakończone. Rozliczenie i wypłata prowizji mają osobny status.' : 'Wydarzenie zakończone. Dokumenty i historia ustaleń pozostają dostępne.')
    : 'Wydarzenie trwa. Bieżące ustalenia pozostają w tej samej sprawie.';
  return <section aria-label="Przebieg współpracy" className="rounded-xl bg-white/[0.035] p-4">
    <ol className="grid grid-cols-2 gap-2 text-xs xl:grid-cols-4">{steps.map((label, i) => <li key={label} aria-current={!interrupted && i === index ? 'step' : undefined} className={`rounded-lg p-2.5 ${!interrupted && i === index ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : i < index && !interrupted ? 'text-emerald-200/80' : 'text-white/40'}`}>{i + 1}. {label}</li>)}</ol>
    <p className="mt-3 text-xs leading-5 text-white/55">{detail}</p>
  </section>;
}
