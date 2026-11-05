'use client';

import { BadgePercent, CalendarDays, FileText, Mail, MessageSquare, Phone, Plus, QrCode, Sparkles, UserRound } from 'lucide-react';
import { demoPln, hexAlpha, initials, readableOn, type DemoConfig } from './demoData';
import type { DemoTab } from './DemoPresentation';

const SAMPLE_OFFERS = [
  { title: 'Wesele — sala balowa', guest: 'Anna i Piotr', value: 18400, status: 'Zaakceptowana przez gościa', tone: 'emerald' },
  { title: 'Konferencja firmy LogiTrans', guest: 'LogiTrans sp. z o.o.', value: 12650, status: 'PDF wysłany gościowi', tone: 'sky' },
  { title: 'Jubileusz 40-lecia', guest: 'Rodzina Kowalskich', value: 7900, status: 'U opiekuna — sprawdzenie', tone: 'amber' },
  { title: 'Gala firmowa — grudzień', guest: 'Nordic Pharma', value: 26300, status: 'Szkic', tone: 'muted' },
] as const;
const SAMPLE_EVENTS = [
  { day: 14, month: 'lis', title: 'Konferencja LogiTrans', detail: 'Sala A · 80 os. · nagłośnienie, ekran LED' },
  { day: 23, month: 'lis', title: 'Wesele Anny i Piotra', detail: 'Sala balowa · 120 os. · DJ, oświetlenie' },
  { day: 6, month: 'gru', title: 'Mikołajki dla dzieci', detail: 'Restauracja · 40 os. · animacje' },
];
const toneClass: Record<string, string> = {
  emerald: 'bg-emerald-400/10 text-emerald-200',
  sky: 'bg-sky-400/10 text-sky-200',
  amber: 'bg-amber-400/10 text-amber-200',
  muted: 'bg-white/[0.06] text-white/55',
};

/** Pseudo-kod QR (dekoracyjny) — w portalu sprzedawca generuje prawdziwy link do formularza zapytania. */
function DecorativeQr({ seed, color }: { seed: string; color: string }) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const cells: boolean[] = [];
  for (let index = 0; index < 21 * 21; index++) { hash = (hash * 1103515245 + 12345) >>> 0; cells.push(((hash >>> 16) & 1) === 1); }
  const finder = (x: number, y: number) => (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
  return <svg viewBox="0 0 21 21" className="h-full w-full" aria-hidden="true">
    <rect width="21" height="21" fill="#fff" />
    {cells.map((on, index) => { const x = index % 21; const y = Math.floor(index / 21); return !finder(x, y) && on ? <rect key={index} x={x} y={y} width="1" height="1" fill="#111522" /> : null; })}
    {[[0, 0], [14, 0], [0, 14]].map(([x, y]) => <g key={`${x}-${y}`}><rect x={x} y={y} width="7" height="7" fill={color} /><rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" /><rect x={x + 2} y={y + 2} width="3" height="3" fill="#111522" /></g>)}
  </svg>;
}

/** Pulpit sprzedawcy — przykładowe liczby i sprawy, tak jak widzi je pracownik hotelu po zalogowaniu. */
export default function DemoDashboard({ config, onNavigate }: { config: DemoConfig; onNavigate: (tab: DemoTab) => void }) {
  const hotel = config.hotelName.trim() || 'Twój hotel';
  const onAccent = readableOn(config.accent);
  const tiles: { label: string; value: string; helper: string; icon: typeof FileText; target: DemoTab }[] = [
    { label: 'Oferty w tym miesiącu', value: '6', helper: '2 czekają na gościa', icon: FileText, target: 'guest' },
    { label: 'Zaakceptowane', value: '3', helper: 'skuteczność 50%', icon: Sparkles, target: 'guest' },
    { label: 'Nadchodzące wydarzenia', value: '3', helper: 'najbliższe za 9 dni', icon: CalendarDays, target: 'how' },
    config.showEarnings
      ? { label: 'Twoje wynagrodzenie', value: demoPln(4860), helper: `prognoza ${demoPln(9420)}`, icon: BadgePercent, target: 'earnings' }
      : { label: 'Zapytania gości', value: '4', helper: '1 nowe z kodu QR', icon: QrCode, target: 'how' },
  ];

  return <div className="space-y-6">
    <section className="flex flex-col gap-4 rounded-3xl p-6 md:flex-row md:items-center md:justify-between md:p-8" style={{ background: `linear-gradient(135deg, ${hexAlpha(config.accent, 0.25)}, ${hexAlpha(config.accent, 0.05)})` }}>
      <div>
        <p className="text-sm text-white/60">Dzień dobry!</p>
        <h2 className="mt-1 text-2xl font-light md:text-3xl">Sprzedawaj wydarzenia w {hotel}</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-white/60">Ofertę dla gościa przygotujesz w kilka minut — z logo hotelu, cenami i opisem usług. Opiekun z {config.brand?.name || 'MAVINCI'} sprawdzi termin i zasoby.</p>
      </div>
      <button type="button" onClick={() => onNavigate('wizard')} className="inline-flex min-h-14 shrink-0 items-center gap-2 rounded-2xl px-6 text-base font-medium shadow-lg transition-transform hover:scale-[1.02]" style={{ background: config.accent, color: onAccent }}><Plus className="h-5 w-5" />Nowa oferta</button>
    </section>

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map(tile => <button key={tile.label} type="button" onClick={() => onNavigate(tile.target)} className="rounded-2xl bg-[#1c1f33] p-4 text-left transition-colors hover:bg-[#232741] md:p-5">
        <span className="flex items-center justify-between text-xs text-white/50">{tile.label}<tile.icon className="h-4 w-4" style={{ color: config.accent }} /></span>
        <span className="mt-2 block text-2xl font-light md:text-3xl">{tile.value}</span>
        <span className="mt-1 block text-xs text-white/40">{tile.helper}</span>
      </button>)}
    </section>

    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <section className="rounded-2xl bg-[#1c1f33] p-5">
        <div className="flex items-center justify-between"><h3 className="text-base font-medium">Ostatnie oferty</h3><span className="text-xs text-white/40">przykładowe dane</span></div>
        <ul className="mt-4 space-y-2">
          {SAMPLE_OFFERS.map(offer => <li key={offer.title} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#0f1119]/70 p-3">
            <span className="min-w-0"><span className="block truncate text-sm">{offer.title}</span><span className="block truncate text-xs text-white/45">{offer.guest} · {demoPln(offer.value)} netto</span></span>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${toneClass[offer.tone]}`}>{offer.status}</span>
          </li>)}
        </ul>
      </section>
      <section className="space-y-4">
        <div className="rounded-2xl bg-[#1c1f33] p-5">
          <h3 className="text-base font-medium">Twój opiekun</h3>
          <div className="mt-4 flex items-center gap-3">
            <span className="flex h-14 w-14 items-center justify-center rounded-full text-base font-medium" style={{ background: hexAlpha(config.accent, 0.2), color: config.accent }}>{config.presenterName ? initials(config.presenterName) : <UserRound className="h-6 w-6" />}</span>
            <span className="min-w-0"><span className="block truncate text-sm">{config.presenterName || 'Opiekun MAVINCI'}</span><span className="block text-xs text-white/45">{config.brand?.name || 'MAVINCI'} · odpowiada zwykle w ciągu godziny</span></span>
          </div>
          <div className="mt-4 grid gap-2 text-sm">
            {config.presenterPhone && <span className="flex items-center gap-2 rounded-xl bg-[#0f1119]/70 px-3 py-2.5 text-white/70"><Phone className="h-4 w-4" style={{ color: config.accent }} />{config.presenterPhone}</span>}
            {config.presenterEmail && <span className="flex items-center gap-2 truncate rounded-xl bg-[#0f1119]/70 px-3 py-2.5 text-white/70"><Mail className="h-4 w-4 shrink-0" style={{ color: config.accent }} /><span className="truncate">{config.presenterEmail}</span></span>}
            <span className="flex items-center gap-2 rounded-xl bg-[#0f1119]/70 px-3 py-2.5 text-white/70"><MessageSquare className="h-4 w-4" style={{ color: config.accent }} />Czat z opiekunem w portalu</span>
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-2xl bg-[#1c1f33] p-5">
          <span className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-white p-1.5"><DecorativeQr seed={hotel} color={config.accent} /></span>
          <span><span className="block text-sm font-medium">Zapytania gości z kodu QR</span><span className="mt-1 block text-xs leading-5 text-white/50">Kod przy recepcji lub w pokoju. Gość zostawia zapytanie, a Ty i opiekun dostajecie powiadomienie.</span></span>
        </div>
      </section>
    </div>

    <section className="rounded-2xl bg-[#1c1f33] p-5">
      <h3 className="text-base font-medium">Nadchodzące wydarzenia</h3>
      <ul className="mt-4 grid gap-2 md:grid-cols-3">
        {SAMPLE_EVENTS.map(event => <li key={event.title} className="flex items-center gap-3 rounded-xl bg-[#0f1119]/70 p-3">
          <span className="flex w-12 shrink-0 flex-col items-center rounded-lg py-1.5" style={{ background: hexAlpha(config.accent, 0.15), color: config.accent }}><span className="text-lg font-medium leading-none">{event.day}</span><span className="mt-0.5 text-[10px] uppercase">{event.month}</span></span>
          <span className="min-w-0"><span className="block truncate text-sm">{event.title}</span><span className="block truncate text-xs text-white/45">{event.detail}</span></span>
        </li>)}
      </ul>
    </section>
  </div>;
}
