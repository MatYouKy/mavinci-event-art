'use client';
import { CheckCircle2, RotateCcw, Send, Undo2 } from 'lucide-react';
import { formatPln, type EventSettlement } from '@/lib/events/settlement/eventSettlement';
import type { AskConfirm } from './SettlementLineRow';
import type { SettlementMutate } from './useEventSettlement';
import { accentButtonClass, dangerButtonClass, primaryButtonClass, secondaryButtonClass } from './settlementUi';

function KeyTotals({ settlement }: { settlement: EventSettlement }) {
  const { totals } = settlement;
  return (
    <dl className="grid gap-2 rounded-lg bg-white/[0.04] p-3 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-xs text-[#e5e4e2]/50">Przychód netto</dt>
        <dd className="tabular-nums text-[#e5e4e2]">{formatPln(totals.revenue_net)}</dd>
      </div>
      <div>
        <dt className="text-xs text-[#e5e4e2]/50">Zysk netto</dt>
        <dd className="tabular-nums text-[#d3bb73]">{formatPln(totals.profit_net)}</dd>
      </div>
      <div>
        <dt className="text-xs text-[#e5e4e2]/50">Prowizje pracowników</dt>
        <dd className="tabular-nums text-[#e5e4e2]">{formatPln(totals.internal_commissions)}</dd>
      </div>
    </dl>
  );
}

/**
 * Obieg podsumowania: wysłanie (sprzedaż), zatwierdzenie / zwrot / ponowne otwarcie (administrator).
 * Każda operacja z potwierdzeniem; wysłanie i zatwierdzenie przekazują source_key (baza odrzuci nieaktualne dane).
 */
export default function SettlementActionBar({
  eventId,
  settlement,
  busy,
  mutate,
  askConfirm,
}: {
  eventId: string;
  settlement: EventSettlement;
  busy: string | null;
  mutate: SettlementMutate;
  askConfirm: AskConfirm;
}) {
  const { can_submit, can_approve, can_return, can_reopen, can_edit, status } = settlement;
  const showSubmitHint = can_edit && !can_submit && status === 'draft';
  if (!can_submit && !can_approve && !can_return && !can_reopen && !showSubmitHint) return null;
  const disabled = Boolean(busy);

  const submit = () =>
    askConfirm(
      {
        key: `submit:${settlement.source_key}`,
        title: 'Wysłać podsumowanie do zatwierdzenia?',
        description: 'Administrator dostanie powiadomienie. Do czasu decyzji podsumowania nie można zmieniać.',
        body: <KeyTotals settlement={settlement} />,
        confirmLabel: 'Wyślij do zatwierdzenia',
        note: { label: 'Notatka dla zatwierdzającego', required: false, placeholder: 'Np. koszt transportu potwierdzony z fakturą…' },
      },
      note =>
        mutate(
          'submit',
          'submit_event_settlement',
          { p_event_id: eventId, p_note: note || null, p_expected_source_key: settlement.source_key },
          'Podsumowanie wysłane do zatwierdzenia.',
        ),
    );

  const approve = () =>
    askConfirm(
      {
        key: `approve:${settlement.source_key}`,
        title: 'Zatwierdzić podsumowanie?',
        description: settlement.clawback
          ? 'Wydarzenie jest anulowane — zatwierdzenie wyzeruje prowizje.'
          : 'Prowizje staną się „do wypłaty” z zamrożoną podstawą. Późniejsza zmiana wymaga ponownego otwarcia.',
        body: (
          <div className="space-y-3">
            {settlement.clawback && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-100">
                Niewypłacone prowizje zostaną anulowane, a wypłacone zamienią się w potrącenia z kolejnych prowizji tych osób.
              </p>
            )}
            <KeyTotals settlement={settlement} />
          </div>
        ),
        confirmLabel: 'Zatwierdź',
      },
      () =>
        mutate(
          'approve',
          'approve_event_settlement',
          { p_event_id: eventId, p_expected_source_key: settlement.source_key },
          'Podsumowanie zatwierdzone — prowizje są do wypłaty.',
        ),
    );

  const giveBack = () =>
    askConfirm(
      {
        key: 'return',
        title: 'Zwrócić podsumowanie do poprawy?',
        description: 'Osoba, która wysłała podsumowanie, dostanie powiadomienie z Twoją uwagą.',
        confirmLabel: 'Zwróć do poprawy',
        tone: 'danger',
        note: { label: 'Co trzeba poprawić', required: true, placeholder: 'Np. brakuje faktury za nagłośnienie' },
      },
      note => mutate('return', 'return_event_settlement', { p_event_id: eventId, p_note: note }, 'Podsumowanie zwrócone do poprawy.'),
    );

  const reopen = () =>
    askConfirm(
      {
        key: 'reopen',
        title: 'Otworzyć podsumowanie ponownie?',
        description:
          'Podsumowanie wróci do wersji roboczej. Po ponownym zatwierdzeniu wpisy bez wypłat przyjmą nowe kwoty, a po wypłacie powstanie dopłata albo potrącenie.',
        confirmLabel: 'Otwórz ponownie',
        tone: 'danger',
        note: { label: 'Powód ponownego otwarcia', required: true, placeholder: 'Np. doszła faktura kosztowa po zatwierdzeniu' },
        option: {
          label: 'Przelicz stawki według aktualnych warunków',
          hint: 'Zwykle zatwierdzona prowizja zachowuje swoją stawkę. Zaznacz, gdy stawka była ustawiona błędnie i została już poprawiona przy pracowniku lub w kartotece sprzedawców. Dotyczy wszystkich osób w wydarzeniu — kogo zmiana obejmie, pokażą ostrzeżenia podsumowania.',
        },
      },
      (note, refreshRates) =>
        mutate(
          'reopen',
          'reopen_event_settlement',
          { p_event_id: eventId, p_reason: note, p_refresh_rates: refreshRates },
          refreshRates ? 'Podsumowanie otwarte ponownie — stawki zostaną przeliczone.' : 'Podsumowanie otwarte ponownie.',
        ),
    );

  return (
    <section aria-label="Obieg podsumowania" className="flex flex-wrap items-center gap-2 rounded-xl bg-white/5 p-3 sm:p-4">
      {(can_submit || showSubmitHint) && (
        <button type="button" disabled={disabled || !can_submit} onClick={submit} className={primaryButtonClass}>
          <Send className="h-4 w-4" aria-hidden />
          Wyślij do zatwierdzenia
        </button>
      )}
      {can_approve && (
        <button type="button" disabled={disabled} onClick={approve} className={primaryButtonClass}>
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          Zatwierdź
        </button>
      )}
      {can_return && (
        <button type="button" disabled={disabled} onClick={giveBack} className={dangerButtonClass}>
          <Undo2 className="h-4 w-4" aria-hidden />
          Zwróć do poprawy
        </button>
      )}
      {can_reopen && (
        <button type="button" disabled={disabled} onClick={reopen} className={settlement.stale ? accentButtonClass : secondaryButtonClass}>
          <RotateCcw className="h-4 w-4" aria-hidden />
          Otwórz ponownie
        </button>
      )}
      {showSubmitHint && (
        <p className="text-xs text-[#e5e4e2]/55">Uzupełnij pozycje z listy „Do uzupełnienia przed wysłaniem”, aby wysłać podsumowanie.</p>
      )}
      {status === 'submitted' && can_return && !can_approve && !settlement.submitted_stale && (
        <p className="text-xs text-[#e5e4e2]/55">Zatwierdzenie jest niedostępne — sprawdź listę „Do uzupełnienia”.</p>
      )}
    </section>
  );
}
