'use client';

import { useState } from 'react';
import { Banknote, CalendarDays, Info, Percent, TrendingUp } from 'lucide-react';
import { demoPln, hexAlpha, type DemoConfig } from './demoData';

function Slider({ label, icon: Icon, value, min, max, step, format, onChange, accent, suffix }: {
  label: string; icon: typeof CalendarDays; value: number; min: number; max: number; step: number;
  format: (value: number) => string; onChange: (value: number) => void; accent: string; suffix?: string;
}) {
  return <div className="rounded-2xl bg-[#1c1f33] p-5">
    <div className="flex items-center justify-between gap-3">
      <p className="flex items-center gap-2 text-sm text-white/70"><Icon className="h-4 w-4" style={{ color: accent }} />{label}</p>
      <label className="flex items-center gap-1 rounded-xl bg-[#0f1119] px-3 py-1.5">
        <input type="number" inputMode="numeric" min={min} max={max} step={step} value={value}
          onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next))); }}
          className="w-24 bg-transparent text-right text-lg font-light outline-none" aria-label={label} />
        {suffix && <span className="text-sm text-white/45">{suffix}</span>}
      </label>
    </div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-4 h-10 w-full cursor-pointer" style={{ accentColor: accent }} aria-label={`${label} — suwak`} />
    <div className="flex justify-between text-[11px] text-white/35"><span>{format(min)}</span><span>{format(max)}</span></div>
  </div>;
}

/** Kalkulator wynagrodzenia: wydarzenia w roku × średnia wartość netto × stawka %. Tylko gdy włączono „pokaż wynagrodzenie”. */
export default function DemoEarnings({ config }: { config: DemoConfig }) {
  const [events, setEvents] = useState(12);
  const [average, setAverage] = useState(15000);
  const [rate, setRate] = useState(10);
  const yearly = events * average * (rate / 100);
  const perEvent = average * (rate / 100);
  const months = Array.from({ length: 12 }, (_, index) => {
    // Sezonowość poglądowa: więcej wydarzeń wiosną, latem i w grudniu.
    const weights = [0.5, 0.6, 0.8, 1, 1.3, 1.5, 1.4, 1.2, 1.3, 1, 0.9, 1.5];
    const sum = weights.reduce((total, weight) => total + weight, 0);
    return yearly * weights[index] / sum;
  });
  const peak = Math.max(...months, 1);
  const monthLabels = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

  return <div className="space-y-5">
    <section className="rounded-3xl p-6 md:p-8" style={{ background: `linear-gradient(135deg, ${hexAlpha(config.accent, 0.28)}, ${hexAlpha(config.accent, 0.05)})` }}>
      <p className="text-sm text-white/60">Twoje wynagrodzenie z wydarzeń w {config.hotelName.trim() || 'hotelu'}</p>
      <p className="mt-2 text-5xl font-light md:text-6xl">{demoPln(yearly)}<span className="ml-2 text-lg text-white/55">rocznie</span></p>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <span className="rounded-full bg-black/20 px-4 py-2">{demoPln(yearly / 12)} miesięcznie średnio</span>
        <span className="rounded-full bg-black/20 px-4 py-2">{demoPln(perEvent)} z jednego wydarzenia</span>
      </div>
    </section>

    <div className="grid gap-3 lg:grid-cols-3">
      <Slider label="Wydarzenia w roku" icon={CalendarDays} value={events} min={1} max={60} step={1} format={value => String(value)} onChange={setEvents} accent={config.accent} />
      <Slider label="Średnia wartość netto" icon={Banknote} value={average} min={2000} max={60000} step={500} format={value => demoPln(value)} onChange={setAverage} accent={config.accent} suffix="zł" />
      <Slider label="Stawka" icon={Percent} value={rate} min={1} max={20} step={0.5} format={value => `${value}%`} onChange={setRate} accent={config.accent} suffix="%" />
    </div>

    <section className="rounded-2xl bg-[#1c1f33] p-5">
      <h3 className="flex items-center gap-2 text-base font-medium"><TrendingUp className="h-4 w-4" style={{ color: config.accent }} />Rozkład w roku (sezonowość poglądowa)</h3>
      <div className="mt-5 flex h-40 items-end gap-1.5 md:gap-2" role="img" aria-label={`Wynagrodzenie miesięcznie: ${months.map((value, index) => `${monthLabels[index]} ${demoPln(value)}`).join(', ')}`}>
        {months.map((value, index) => <div key={monthLabels[index]} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
          <span className="w-full rounded-t-lg transition-all" style={{ height: `${Math.max(4, (value / peak) * 100)}%`, background: `linear-gradient(180deg, ${config.accent}, ${hexAlpha(config.accent, 0.35)})` }} title={`${monthLabels[index]}: ${demoPln(value)}`} />
          <span className="text-[10px] text-white/40">{monthLabels[index]}</span>
        </div>)}
      </div>
    </section>

    <p className="flex items-start gap-2 rounded-2xl bg-white/[0.03] p-4 text-xs leading-5 text-white/50"><Info className="mt-0.5 h-4 w-4 shrink-0" />Kalkulacja poglądowa. Wynagrodzenie liczymy od wartości netto wydarzenia bez usług zewnętrznych wykonawców i wypłacamy po rozliczeniu wydarzenia. Stawkę i zasady potwierdza umowa współpracy; w portalu sprzedawca widzi każde naliczenie i wypłatę.</p>
  </div>;
}
