'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, FileText, Minus, Plus, Search, Sparkles, Users } from 'lucide-react';
import SellerDatePicker from '@/app/(public)/seller/_components/SellerDatePicker';
import { DEMO_EVENT_TYPES, demoPln, demoTotals, hexAlpha, readableOn, type DemoConfig, type DemoOfferDraft, type DemoService } from './demoData';

type Props = {
  config: DemoConfig;
  services: DemoService[];
  servicesSource: 'catalog' | 'sample';
  draft: DemoOfferDraft;
  onDraftChange: (draft: DemoOfferDraft) => void;
  onShowGuestOffer: () => void;
};

const STEPS = ['Wydarzenie', 'Usługi', 'Cena dla gościa'];
const field = 'w-full rounded-xl bg-[#0f1119] px-4 py-3 text-base text-[#e5e4e2] outline-none ring-1 ring-white/[0.06] placeholder:text-white/25 focus:ring-white/20';

/** Kreator oferty w 3 krokach — jak w portalu, ale bez zapisu (stan tylko w pamięci). */
export default function DemoOfferWizard({ config, services, servicesSource, draft, onDraftChange, onShowGuestOffer }: Props) {
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [dateValid, setDateValid] = useState(true);
  const onAccent = readableOn(config.accent);
  const update = (patch: Partial<DemoOfferDraft>) => onDraftChange({ ...draft, ...patch });
  const totals = useMemo(() => demoTotals(draft, services), [draft, services]);
  const categories = useMemo(() => [...new Set(services.map(service => service.category).filter((value): value is string => Boolean(value)))].slice(0, 12), [services]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pl-PL');
    return services.filter(service => (!category || service.category === category)
      && (!needle || `${service.name} ${service.description}`.toLocaleLowerCase('pl-PL').includes(needle)));
  }, [services, category, query]);
  const quantityOf = (id: string) => draft.items.find(item => item.serviceId === id)?.quantity || 0;
  const setQuantity = (id: string, quantity: number) => {
    const rest = draft.items.filter(item => item.serviceId !== id);
    update({ items: quantity > 0 ? [...rest, { serviceId: id, quantity: Math.min(quantity, 99) }] : rest });
  };
  const canNext = step === 0 ? dateValid && draft.guests > 0 && draft.guestName.trim().length > 0 : step === 1 ? draft.items.length > 0 : true;
  const nextHint = step === 0 ? (!draft.guestName.trim() ? 'Wpisz nazwę gościa lub firmy.' : !dateValid ? 'Popraw datę wydarzenia.' : '') : step === 1 && !draft.items.length ? 'Dodaj co najmniej jedną usługę.' : '';

  return <div className="space-y-5">
    <ol className="grid grid-cols-3 gap-2" aria-label="Kroki kreatora">
      {STEPS.map((label, index) => {
        const done = index < step; const active = index === step;
        return <li key={label}><button type="button" onClick={() => (index <= step || canNext) && setStep(index)} className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors md:p-4 ${active ? '' : 'bg-[#1c1f33] hover:bg-[#232741]'}`} style={active ? { background: hexAlpha(config.accent, 0.2) } : undefined}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium" style={done || active ? { background: config.accent, color: onAccent } : { background: 'rgba(255,255,255,0.08)' }}>{done ? <Check className="h-4 w-4" /> : index + 1}</span>
          <span className="hidden min-w-0 sm:block"><span className="block text-[10px] uppercase tracking-wide text-white/40">Krok {index + 1}</span><span className="block truncate text-sm">{label}</span></span>
        </button></li>;
      })}
    </ol>

    {step === 0 && <section className="space-y-5 rounded-3xl bg-[#1c1f33] p-5 md:p-7">
      <div>
        <h2 className="text-xl font-light">Jakie wydarzenie planuje gość?</h2>
        <p className="mt-1 text-sm text-white/50">Rodzaj, termin i liczba gości — opiekun od razu sprawdzi dostępność zespołu i sprzętu.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {DEMO_EVENT_TYPES.map(type => <button key={type.id} type="button" aria-pressed={draft.eventType === type.id} onClick={() => update({ eventType: type.id })} className="min-h-12 rounded-xl px-5 text-sm transition-colors" style={draft.eventType === type.id ? { background: config.accent, color: onAccent } : { background: 'rgba(15,17,25,0.7)' }}>{type.label}</button>)}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <SellerDatePicker label="Termin wydarzenia" value={draft.eventDate} onChange={eventDate => update({ eventDate })} onValidityChange={setDateValid} />
        <div>
          <p className="text-xs text-white/50">Liczba gości</p>
          <div className="mt-1.5 flex items-center gap-2">
            <button type="button" aria-label="Mniej gości" onClick={() => update({ guests: Math.max(1, draft.guests - 10) })} className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.06] hover:bg-white/10"><Minus className="h-4 w-4" /></button>
            <label className="relative flex-1"><Users className="absolute left-3 top-3.5 h-4 w-4 text-white/30" /><input type="number" min={1} max={2000} inputMode="numeric" value={draft.guests} onChange={(event) => update({ guests: Math.max(0, Math.min(2000, Number(event.target.value) || 0)) })} className={`${field} h-11 py-0 pl-9 text-center`} aria-label="Liczba gości" /></label>
            <button type="button" aria-label="Więcej gości" onClick={() => update({ guests: Math.min(2000, draft.guests + 10) })} className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.06] hover:bg-white/10"><Plus className="h-4 w-4" /></button>
          </div>
        </div>
        <label className="text-xs text-white/50">Gość / zamawiający<input value={draft.guestName} onChange={(event) => update({ guestName: event.target.value.slice(0, 80) })} className={`${field} mt-1.5`} placeholder="np. Anna i Piotr Nowak" /></label>
        <label className="text-xs text-white/50">Firma <span className="text-white/30">(opcjonalnie)</span><input value={draft.guestCompany} onChange={(event) => update({ guestCompany: event.target.value.slice(0, 80) })} className={`${field} mt-1.5`} placeholder="np. LogiTrans sp. z o.o." /></label>
      </div>
    </section>}

    {step === 1 && <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-3xl bg-[#1c1f33] p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-light">Wybierz usługi</h2>
          <p className="mt-1 text-sm text-white/50">{servicesSource === 'catalog' ? 'Aktualny katalog usług — opisy i zdjęcia przygotowuje zespół.' : 'Przykładowe usługi.'} Ceny poglądowe.</p>
        </div>
        <label className="relative w-full md:w-72"><Search className="absolute left-3 top-3.5 h-4 w-4 text-white/30" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj usługi…" className={`${field} h-11 py-0 pl-9`} /></label>
      </div>
      {categories.length > 1 && <div className="flex gap-2 overflow-x-auto pb-1">
        {['', ...categories].map(value => <button key={value || 'all'} type="button" onClick={() => setCategory(value)} className="min-h-10 shrink-0 rounded-full px-4 text-sm transition-colors" style={category === value ? { background: hexAlpha(config.accent, 0.25), color: '#fff' } : { background: 'rgba(28,31,51,1)', color: 'rgba(229,228,226,0.6)' }}>{value || 'Wszystkie'}</button>)}
      </div>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map(service => {
          const quantity = quantityOf(service.id);
          return <article key={service.id} className="flex flex-col overflow-hidden rounded-2xl bg-[#1c1f33] transition-shadow" style={quantity ? { boxShadow: `0 0 0 2px ${hexAlpha(config.accent, 0.7)}` } : undefined}>
            {service.imageUrl ? <img src={service.imageUrl} alt="" loading="lazy" className="h-36 w-full object-cover" /> : <div className="flex h-24 items-center justify-center" style={{ background: `linear-gradient(135deg, ${hexAlpha(config.accent, 0.22)}, ${hexAlpha(config.accent, 0.04)})` }}><Sparkles className="h-6 w-6" style={{ color: config.accent }} /></div>}
            <div className="flex flex-1 flex-col p-4">
              {service.category && <p className="text-[10px] uppercase tracking-wide text-white/40">{service.category}</p>}
              <h3 className="mt-0.5 text-base">{service.name}</h3>
              {service.description && <p className="mt-1 line-clamp-3 text-xs leading-5 text-white/50">{service.description}</p>}
              <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                <span className="text-sm">{service.priceNet && service.priceNet > 0 ? <>{demoPln(service.priceNet)}<span className="text-xs text-white/40"> netto / {service.unit}</span></> : <span className="text-xs text-white/50">wycena indywidualna</span>}</span>
                {quantity === 0
                  ? <button type="button" onClick={() => setQuantity(service.id, 1)} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-medium" style={{ background: config.accent, color: onAccent }}><Plus className="h-4 w-4" />Dodaj</button>
                  : <span className="flex items-center gap-1 rounded-xl bg-[#0f1119] p-1">
                    <button type="button" aria-label={`Mniej: ${service.name}`} onClick={() => setQuantity(service.id, quantity - 1)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/10"><Minus className="h-4 w-4" /></button>
                    <span className="w-6 text-center text-sm">{quantity}</span>
                    <button type="button" aria-label={`Więcej: ${service.name}`} onClick={() => setQuantity(service.id, quantity + 1)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/10"><Plus className="h-4 w-4" /></button>
                  </span>}
              </div>
            </div>
          </article>;
        })}
        {visible.length === 0 && <p className="rounded-2xl bg-[#1c1f33] p-8 text-center text-sm text-white/40 sm:col-span-2 xl:col-span-3">Brak usług spełniających wyszukiwanie.</p>}
      </div>
    </section>}

    {step === 2 && <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="rounded-3xl bg-[#1c1f33] p-5 md:p-7">
        <h2 className="text-xl font-light">Cena dla gościa</h2>
        <p className="mt-1 text-sm text-white/50">Pracujesz na cenniku partnera. Narzut hotelu dodajesz sam — gość widzi jedną, końcową cenę.</p>
        <div className="mt-6">
          <div className="flex items-center justify-between text-sm"><span>Narzut hotelu</span><span className="text-2xl font-light" style={{ color: config.accent }}>{draft.markupPercent}%</span></div>
          <input type="range" min={0} max={40} step={1} value={draft.markupPercent} onChange={(event) => update({ markupPercent: Number(event.target.value) })} className="mt-3 h-10 w-full cursor-pointer" style={{ accentColor: config.accent }} aria-label="Narzut hotelu w procentach" />
          <div className="mt-1 flex justify-between text-[11px] text-white/35"><span>0%</span><span>20%</span><span>40%</span></div>
        </div>
        <ul className="mt-6 space-y-1.5">
          {totals.lines.map(line => <li key={line.item.serviceId} className="flex items-center justify-between gap-3 rounded-xl bg-[#0f1119]/70 px-3 py-2.5 text-sm">
            <span className="min-w-0 truncate">{line.service!.name}{line.item.quantity > 1 ? <span className="text-white/45"> × {line.item.quantity}</span> : null}</span>
            <span className="shrink-0">{line.guest == null ? <span className="text-xs text-white/45">do wyceny</span> : demoPln(line.guest)}</span>
          </li>)}
        </ul>
      </div>
      <aside className="space-y-3">
        <div className="rounded-3xl p-5 md:p-6" style={{ background: `linear-gradient(135deg, ${hexAlpha(config.accent, 0.3)}, ${hexAlpha(config.accent, 0.08)})` }}>
          <p className="text-xs uppercase tracking-wide text-white/60">Gość zapłaci</p>
          <p className="mt-1 text-4xl font-light">{demoPln(totals.guestNet)}<span className="text-base text-white/60"> netto</span></p>
          <p className="mt-1 text-sm text-white/60">{demoPln(totals.gross)} brutto (VAT 23%)</p>
          {totals.onRequest > 0 && <p className="mt-3 text-xs text-white/60">+ {totals.onRequest === 1 ? '1 pozycja' : `${totals.onRequest} pozycje`} do indywidualnej wyceny przez opiekuna</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-[#1c1f33] p-4"><p className="text-[11px] uppercase tracking-wide text-white/40">Cennik partnera</p><p className="mt-1 text-lg font-light">{demoPln(totals.baseNet)}</p></div>
          <div className="rounded-2xl bg-[#1c1f33] p-4"><p className="text-[11px] uppercase tracking-wide text-white/40">Narzut hotelu</p><p className="mt-1 text-lg font-light" style={{ color: config.accent }}>{demoPln(totals.markup)}</p></div>
        </div>
        <button type="button" onClick={onShowGuestOffer} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-medium shadow-lg transition-transform hover:scale-[1.01]" style={{ background: config.accent, color: onAccent }}><FileText className="h-5 w-5" />Zobacz ofertę dla gościa</button>
        <p className="text-center text-xs text-white/40">W portalu jednym kliknięciem powstaje PDF i link dla gościa, a opiekun sprawdza termin i zasoby.</p>
      </aside>
    </section>}

    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" onClick={() => setStep(value => Math.max(0, value - 1))} disabled={step === 0} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-white/[0.05] px-5 text-sm hover:bg-white/10 disabled:opacity-30"><ChevronLeft className="h-4 w-4" />Wstecz</button>
      <span className="text-xs text-white/45">{nextHint || (step === 1 ? `Wybrane usługi: ${draft.items.length}` : '')}</span>
      {step < 2 && <button type="button" onClick={() => canNext && setStep(value => value + 1)} disabled={!canNext} className="inline-flex min-h-12 items-center gap-2 rounded-xl px-6 text-sm font-medium disabled:opacity-40" style={{ background: config.accent, color: onAccent }}>Dalej<ChevronRight className="h-4 w-4" /></button>}
    </div>
  </div>;
}
