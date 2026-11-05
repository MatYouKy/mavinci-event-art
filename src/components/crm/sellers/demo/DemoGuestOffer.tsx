'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Link2, Pencil, Wand2 } from 'lucide-react';
import { DEMO_EVENT_TYPES, demoDate, demoPln, demoTotals, hexAlpha, initials, readableOn, type DemoConfig, type DemoOfferDraft, type DemoService } from './demoData';

/** Podgląd oferty dla gościa w barwach hotelu (tak wygląda link / PDF wysyłany gościowi). */
export default function DemoGuestOffer({ config, services, draft, onEdit }: { config: DemoConfig; services: DemoService[]; draft: DemoOfferDraft; onEdit: () => void }) {
  const [accepted, setAccepted] = useState(false);
  const totals = useMemo(() => demoTotals(draft, services), [draft, services]);
  const hotel = config.hotelName.trim() || 'Twój hotel';
  const brand = config.brand?.name || 'MAVINCI';
  const onAccent = readableOn(config.accent);
  const eventLabel = DEMO_EVENT_TYPES.find(type => type.id === draft.eventType)?.label || 'Wydarzenie';
  const validUntil = new Date(Date.now() + 14 * 86_400_000).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });

  if (!totals.lines.length) return <div className="flex flex-col items-center rounded-3xl bg-[#1c1f33] p-10 text-center">
    <span className="rounded-2xl p-4" style={{ background: hexAlpha(config.accent, 0.15) }}><Wand2 className="h-8 w-8" style={{ color: config.accent }} /></span>
    <h2 className="mt-4 text-xl font-light">Najpierw wybierz usługi</h2>
    <p className="mt-2 max-w-md text-sm text-white/50">Oferta dla gościa powstaje z kreatora: rodzaj wydarzenia, termin, usługi i cena hotelu.</p>
    <button type="button" onClick={onEdit} className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-xl px-5 text-sm font-medium" style={{ background: config.accent, color: onAccent }}><Wand2 className="h-4 w-4" />Otwórz kreator oferty</button>
  </div>;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="flex items-center gap-2 text-sm text-white/55"><Link2 className="h-4 w-4" />Gość otrzymuje link do oferty oraz PDF — z logo i kolorami hotelu.</p>
      <button type="button" onClick={onEdit} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/[0.06] px-4 text-sm hover:bg-white/10"><Pencil className="h-4 w-4" />Zmień ofertę</button>
    </div>

    <article className="mx-auto max-w-4xl overflow-hidden rounded-3xl bg-[#faf7f2] text-[#1d1b20] shadow-[0_30px_90px_rgba(0,0,0,0.5)]">
      <header className="relative px-6 pb-8 pt-7 md:px-10 md:pt-10" style={{ background: `linear-gradient(135deg, ${config.accent}, ${hexAlpha(config.accent, 0.78)})`, color: onAccent }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-white shadow md:h-20 md:w-20">
              {config.logoUrl ? <img src={config.logoUrl} alt={`Logo ${hotel}`} className="h-full w-full object-contain p-2" /> : <span className="text-lg font-medium text-[#1d1b20]/70">{initials(hotel)}</span>}
            </span>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] opacity-75">Oferta wydarzenia</p>
              <h2 className="mt-1 text-2xl font-light md:text-3xl">{hotel}</h2>
            </div>
          </div>
          <span className="rounded-full bg-black/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider">Tryb pokazowy</span>
        </div>
        <div className="mt-8 grid gap-4 text-sm sm:grid-cols-4">
          {[['Dla', [draft.guestName || 'Gość', draft.guestCompany].filter(Boolean).join(' · ')], ['Wydarzenie', eventLabel], ['Termin', demoDate(draft.eventDate)], ['Goście', `${draft.guests} os.`]].map(([label, value]) => (
            <div key={label}><p className="text-[10px] uppercase tracking-wider opacity-70">{label}</p><p className="mt-0.5 font-medium">{value}</p></div>
          ))}
        </div>
      </header>

      <div className="px-6 py-7 md:px-10">
        <p className="text-sm leading-6 text-[#1d1b20]/70">Szanowni Państwo, z przyjemnością przedstawiamy propozycję oprawy wydarzenia w {hotel}. Realizację zapewnia nasz partner {brand} — zespół, sprzęt i koordynacja na miejscu.</p>
        <table className="mt-6 w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-[#1d1b20]/45"><th className="pb-2 font-medium">Usługa</th><th className="pb-2 text-right font-medium">Ilość</th><th className="pb-2 text-right font-medium">Wartość netto</th></tr></thead>
          <tbody>
            {totals.lines.map(line => <tr key={line.item.serviceId} className="align-top" style={{ boxShadow: `inset 0 1px 0 ${hexAlpha('#1d1b20', 0.06)}` }}>
              <td className="py-3 pr-4"><p className="font-medium">{line.service!.name}</p>{line.service!.description && <p className="mt-0.5 line-clamp-2 text-xs text-[#1d1b20]/55">{line.service!.description}</p>}</td>
              <td className="py-3 text-right text-[#1d1b20]/70">{line.item.quantity} × {line.service!.unit}</td>
              <td className="py-3 text-right font-medium">{line.guest == null ? <span className="text-xs font-normal text-[#1d1b20]/50">wycena indywidualna</span> : demoPln(line.guest)}</td>
            </tr>)}
          </tbody>
        </table>
        <div className="mt-6 flex flex-col items-end gap-1 rounded-2xl p-5" style={{ background: hexAlpha(config.accent, 0.1) }}>
          <p className="text-sm text-[#1d1b20]/60">Razem netto <span className="ml-3 text-lg font-medium text-[#1d1b20]">{demoPln(totals.guestNet)}</span></p>
          <p className="text-xs text-[#1d1b20]/50">VAT 23%: {demoPln(totals.vat)}</p>
          <p className="mt-1 text-2xl font-light text-[#1d1b20]">{demoPln(totals.gross)} <span className="text-sm text-[#1d1b20]/55">brutto</span></p>
          {totals.onRequest > 0 && <p className="mt-1 text-xs text-[#1d1b20]/55">Pozycje do indywidualnej wyceny zostaną potwierdzone przez opiekuna.</p>}
        </div>

        <div className="mt-7 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="text-xs leading-5 text-[#1d1b20]/55">
            <p>Oferta ważna do {validUntil}. Termin i dostępność zasobów potwierdza opiekun {brand}.</p>
            <p>Kontakt: dział sprzedaży {hotel}.</p>
          </div>
          {accepted
            ? <p className="flex items-center gap-2 rounded-2xl bg-emerald-600/10 px-5 py-3 text-sm font-medium text-emerald-800"><CheckCircle2 className="h-5 w-5" />Gość zaakceptował ofertę</p>
            : <button type="button" onClick={() => setAccepted(true)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-6 text-sm font-medium shadow" style={{ background: config.accent, color: onAccent }}><CheckCircle2 className="h-5 w-5" />Akceptuję ofertę</button>}
        </div>
      </div>
    </article>
    {accepted && <p className="mx-auto max-w-4xl rounded-2xl bg-emerald-400/10 p-4 text-center text-sm text-emerald-100">W portalu sprzedawca i opiekun dostają w tej chwili powiadomienie o akceptacji, a opiekun potwierdza termin i przygotowuje realizację. (Tryb pokazowy — nic nie zostało zapisane.)</p>}
  </div>;
}
