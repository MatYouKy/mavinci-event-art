'use client';

import { useState } from 'react';
import { Banknote, Eye, FileText, Handshake, MailPlus, PartyPopper, ShieldCheck, Sparkles, UserRound, Wand2, type LucideIcon } from 'lucide-react';
import { hexAlpha, readableOn, type DemoConfig } from './demoData';

type Step = { title: string; who: string; icon: LucideIcon; text: string };

/** Ścieżka współpracy w 6 krokach: wizyta → zaproszenie → pierwsza oferta → odsłonięcie wynagrodzenia → realizacja → wypłata. */
export default function DemoHowItWorks({ config }: { config: DemoConfig }) {
  const [active, setActive] = useState(0);
  const brand = config.brand?.name || 'MAVINCI';
  const hotel = config.hotelName.trim() || 'hotel';
  const onAccent = readableOn(config.accent);
  const steps: Step[] = [
    { title: 'Wizyta', who: `Opiekun ${brand}`, icon: Handshake, text: `Poznajemy ${hotel}, sale i typowe wydarzenia gości. Ustalamy, kto w hotelu będzie przygotowywał oferty.` },
    { title: 'Zaproszenie', who: 'Opiekun → hotel', icon: MailPlus, text: 'Osoba z hotelu dostaje e-mail z zaproszeniem i sama ustawia hasło. Portal od razu ma logo i kolory hotelu.' },
    { title: 'Pierwsza oferta', who: 'Hotel + opiekun', icon: Wand2, text: 'Pierwszą ofertę przygotowujemy razem: kreator, usługi, cena dla gościa. Opiekun sprawdza termin, zespół i sprzęt.' },
    { title: 'Odsłonięcie wynagrodzenia', who: 'Opiekun', icon: Eye, text: 'Gdy współpraca ruszy, opiekun włącza widoczność wynagrodzenia — sprzedawca widzi stawkę, naliczenia i dostaje powiadomienie.' },
    { title: 'Realizacja', who: brand, icon: PartyPopper, text: 'Gość akceptuje ofertę, a my przejmujemy realizację: plan wydarzenia, osoba na miejscu, sprzęt i obsługa w dniu wydarzenia.' },
    { title: 'Wypłata', who: `${brand} → sprzedawca`, icon: Banknote, text: 'Po rozliczeniu wydarzenia wynagrodzenie trafia do wypłaty. Historia naliczeń i wypłat jest zawsze dostępna w portalu.' },
  ];
  const current = steps[active];

  return <div className="space-y-6">
    <section>
      <h2 className="text-2xl font-light md:text-3xl">Jak to działa</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">Sześć kroków od pierwszej rozmowy do wypłaty. Przez cały czas {hotel} ma jednego opiekuna po stronie {brand}.</p>
    </section>

    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      {steps.map((step, index) => {
        const selected = index === active;
        const done = index < active;
        return <li key={step.title}>
          <button type="button" onClick={() => setActive(index)} aria-current={selected ? 'step' : undefined} className="relative flex h-full min-h-[8.5rem] w-full flex-col rounded-2xl p-4 text-left transition-colors" style={selected ? { background: hexAlpha(config.accent, 0.22) } : { background: '#1c1f33' }}>
            <span className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium" style={selected || done ? { background: config.accent, color: onAccent } : { background: 'rgba(255,255,255,0.08)' }}>{index + 1}</span>
              <step.icon className="h-4 w-4" style={{ color: selected ? config.accent : 'rgba(229,228,226,0.4)' }} />
            </span>
            <span className="mt-3 block text-sm font-medium">{step.title}</span>
            <span className="mt-1 block text-[11px] text-white/45">{step.who}</span>
          </button>
        </li>;
      })}
    </ol>

    <section className="grid gap-4 rounded-3xl bg-[#1c1f33] p-6 md:grid-cols-[auto_1fr] md:items-center md:p-8">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: hexAlpha(config.accent, 0.18) }}><current.icon className="h-8 w-8" style={{ color: config.accent }} /></span>
      <div>
        <p className="text-xs uppercase tracking-wide text-white/40">Krok {active + 1} z {steps.length} · {current.who}</p>
        <h3 className="mt-1 text-xl font-light">{current.title}</h3>
        <p className="mt-2 max-w-3xl text-base leading-7 text-white/65">{current.text}</p>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => setActive(value => Math.max(0, value - 1))} disabled={active === 0} className="min-h-11 rounded-xl bg-white/[0.06] px-4 text-sm hover:bg-white/10 disabled:opacity-30">Poprzedni</button>
          <button type="button" onClick={() => setActive(value => Math.min(steps.length - 1, value + 1))} disabled={active === steps.length - 1} className="min-h-11 rounded-xl px-4 text-sm font-medium disabled:opacity-30" style={{ background: config.accent, color: onAccent }}>Następny krok</button>
        </div>
      </div>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[
        { icon: UserRound, title: 'Jeden opiekun', text: 'Czat w portalu, telefon i pomoc przy każdej ofercie.' },
        { icon: FileText, title: 'Oferta w kilka minut', text: 'Gotowe opisy, zdjęcia i ceny — PDF i link dla gościa.' },
        { icon: Sparkles, title: 'Marka hotelu', text: 'Logo i kolory hotelu na ofertach i w portalu.' },
        { icon: ShieldCheck, title: 'Bez ryzyka', text: 'Termin i zasoby potwierdza opiekun, realizację prowadzi partner.' },
      ].map(item => <div key={item.title} className="rounded-2xl bg-[#1c1f33] p-5">
        <item.icon className="h-5 w-5" style={{ color: config.accent }} />
        <p className="mt-3 text-sm font-medium">{item.title}</p>
        <p className="mt-1 text-xs leading-5 text-white/50">{item.text}</p>
      </div>)}
    </section>
  </div>;
}
