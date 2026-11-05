'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BadgePercent, Check, ImagePlus, Loader2, Lock, Palette, Play, Trash2 } from 'lucide-react';
import { DEMO_ACCENTS, hexAlpha, initials, readableOn, type DemoBrand, type DemoConfig } from './demoData';

type Props = {
  config: DemoConfig;
  onChange: (patch: Partial<DemoConfig>) => void;
  onLogo: (file: File | null) => void;
  brands: DemoBrand[];
  brandsLoading: boolean;
  brandsError: string;
  servicesCount: number;
  servicesSource: 'catalog' | 'sample' | 'loading';
  onStart: () => void;
};

const field = 'w-full rounded-xl bg-[#0f1119] px-4 py-3 text-base text-[#e5e4e2] outline-none ring-1 ring-white/[0.06] placeholder:text-white/25 focus:ring-[#d3bb73]/35';
const MAX_LOGO_BYTES = 8 * 1024 * 1024;

/** Ekran przygotowania pokazu: marka, hotel, logo (lokalnie), kolor, widoczność wynagrodzenia. */
export default function DemoSetup({ config, onChange, onLogo, brands, brandsLoading, brandsError, servicesCount, servicesSource, onStart }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState('');
  const hotel = config.hotelName.trim() || 'Twój hotel';
  const onAccent = readableOn(config.accent);

  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setLogoError('Wybierz plik graficzny (PNG, JPG, SVG lub WEBP).'); return; }
    if (file.size > MAX_LOGO_BYTES) { setLogoError('Logo może mieć najwyżej 8 MB.'); return; }
    setLogoError('');
    onLogo(file);
  };

  return <div className="min-h-screen bg-[#0f1119] px-4 py-6 text-[#e5e4e2] md:px-8 md:py-10">
    <div className="mx-auto max-w-6xl">
      <Link href="/crm/salespeople" className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-white/50 hover:bg-white/5 hover:text-white"><ArrowLeft className="h-4 w-4" />Sprzedawcy</Link>
      <header className="mt-4 max-w-3xl">
        <p className="text-xs uppercase tracking-[0.2em] text-[#d3bb73]">Tryb pokazowy</p>
        <h1 className="mt-2 text-3xl font-light md:text-4xl">Pokaż portal hotelowi</h1>
        <p className="mt-3 text-base leading-7 text-white/55">Przygotuj prezentację portalu sprzedawcy w barwach hotelu. Pokaz działa wyłącznie na tym urządzeniu — nie tworzy ofert, prowizji ani kontaktów i niczego nie wysyła.</p>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-5">
          <section className="rounded-2xl bg-[#1c1f33] p-5 md:p-6">
            <h2 className="text-sm font-medium text-white/80">1. Marka, którą prezentujesz</h2>
            {brandsLoading ? <p className="mt-4 flex items-center gap-2 text-sm text-white/45"><Loader2 className="h-4 w-4 animate-spin" />Wczytywanie marek…</p>
              : brandsError ? <p className="mt-4 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100">{brandsError}</p>
              : brands.length === 0 ? <p className="mt-4 text-sm text-white/45">Brak dostępnych marek — pokaz użyje ogólnej nazwy MAVINCI.</p>
              : <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {brands.map(brand => {
                  const selected = config.brand?.id === brand.id;
                  return <button key={brand.id} type="button" aria-pressed={selected} onClick={() => onChange({ brand })} className={`flex min-h-16 items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors ${selected ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-[#0f1119]/70 text-white/70 hover:bg-[#0f1119]'}`}>
                    {brand.logoUrl ? <img src={brand.logoUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg bg-white/90 object-contain p-1" /> : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-xs">{initials(brand.name)}</span>}
                    <span className="min-w-0 flex-1 truncate text-sm">{brand.name}</span>
                    {selected && <Check className="h-4 w-4 shrink-0" />}
                  </button>;
                })}
              </div>}
          </section>

          <section className="rounded-2xl bg-[#1c1f33] p-5 md:p-6">
            <h2 className="text-sm font-medium text-white/80">2. Hotel</h2>
            <label className="mt-4 block text-xs text-white/50">Nazwa hotelu
              <input value={config.hotelName} onChange={(event) => onChange({ hotelName: event.target.value.slice(0, 120) })} placeholder="np. Hotel Nad Jeziorem" className={`${field} mt-1.5`} autoComplete="off" />
            </label>
            <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
              <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl bg-white/90">
                {config.logoUrl ? <img src={config.logoUrl} alt="Logo hotelu" className="h-full w-full object-contain p-2" /> : <span className="text-2xl font-light text-[#111522]/60">{initials(hotel)}</span>}
              </div>
              <div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => { pickLogo(event.target.files?.[0]); event.target.value = ''; }} />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/[0.06] px-4 text-sm hover:bg-white/10"><ImagePlus className="h-4 w-4 text-[#d3bb73]" />{config.logoUrl ? 'Zmień logo' : 'Dodaj logo hotelu'}</button>
                  {config.logoUrl && <button type="button" onClick={() => onLogo(null)} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm text-white/50 hover:bg-white/5"><Trash2 className="h-4 w-4" />Usuń</button>}
                </div>
                {logoError && <p role="alert" className="mt-2 text-xs text-red-200">{logoError}</p>}
                <p className="mt-2 flex items-start gap-1.5 text-xs text-white/40"><Lock className="mt-0.5 h-3 w-3 shrink-0" />Logo zostaje na tym urządzeniu — nie jest wysyłane ani zapisywane.</p>
              </div>
            </div>
            <div className="mt-5">
              <p className="flex items-center gap-2 text-xs text-white/50"><Palette className="h-3.5 w-3.5" />Kolor akcentu hotelu</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {DEMO_ACCENTS.map(color => <button key={color} type="button" aria-label={`Kolor ${color}`} aria-pressed={config.accent === color} onClick={() => onChange({ accent: color })} className="flex h-11 w-11 items-center justify-center rounded-full transition-transform hover:scale-105" style={{ background: color, boxShadow: config.accent === color ? `0 0 0 3px #1c1f33, 0 0 0 5px ${hexAlpha(color, 0.7)}` : undefined }}>
                  {config.accent === color && <Check className="h-4 w-4" style={{ color: readableOn(color) }} />}
                </button>)}
                <label className="flex h-11 items-center gap-2 rounded-full bg-white/[0.05] px-3 text-xs text-white/60">Własny
                  <input type="color" value={config.accent} onChange={(event) => onChange({ accent: event.target.value })} className="h-7 w-9 cursor-pointer rounded bg-transparent" aria-label="Własny kolor akcentu" />
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-[#1c1f33] p-5 md:p-6">
            <h2 className="text-sm font-medium text-white/80">3. Co pokazać</h2>
            <button type="button" role="switch" aria-checked={config.showEarnings} onClick={() => onChange({ showEarnings: !config.showEarnings })} className="mt-4 flex w-full items-start gap-4 rounded-xl bg-[#0f1119]/70 p-4 text-left hover:bg-[#0f1119]">
              <span className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${config.showEarnings ? 'bg-emerald-400/70' : 'bg-white/15'}`}><span className={`absolute h-6 w-6 rounded-full bg-white shadow transition-transform ${config.showEarnings ? 'translate-x-[22px]' : 'translate-x-0.5'}`} /></span>
              <span><span className="flex items-center gap-2 text-sm"><BadgePercent className="h-4 w-4 text-[#d3bb73]" />Pokaż wynagrodzenie</span><span className="mt-1 block text-xs leading-5 text-white/45">Zakładka z kalkulatorem prowizji i kwoty w pulpicie. Wyłącz, jeśli z hotelem rozmawiasz najpierw o usługach, a o wynagrodzeniu — później.</span></span>
            </button>
            <label className="mt-4 block text-xs text-white/50">Opiekun widoczny w portalu
              <input value={config.presenterName} onChange={(event) => onChange({ presenterName: event.target.value.slice(0, 80) })} placeholder="Imię i nazwisko" className={`${field} mt-1.5`} />
            </label>
          </section>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="overflow-hidden rounded-3xl bg-[#1c1f33] shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
            <div className="p-5" style={{ background: `linear-gradient(135deg, ${hexAlpha(config.accent, 0.35)}, ${hexAlpha(config.accent, 0.08)})` }}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/95">
                    {config.logoUrl ? <img src={config.logoUrl} alt="" className="h-full w-full object-contain p-1.5" /> : <span className="text-sm font-medium text-[#111522]/70">{initials(hotel)}</span>}
                  </span>
                  <span className="min-w-0"><span className="block truncate text-base font-medium">{hotel}</span><span className="block truncate text-xs text-white/60">Portal sprzedawcy · {config.brand?.name || 'MAVINCI'}</span></span>
                </div>
                <span className="shrink-0 rounded-full bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-wider text-white/80">Tryb pokazowy</span>
              </div>
            </div>
            <div className="space-y-3 p-5">
              <div className="grid grid-cols-3 gap-2">
                {['Oferty', 'Wydarzenia', config.showEarnings ? 'Wynagrodzenie' : 'Zapytania'].map(label => <div key={label} className="rounded-xl bg-[#0f1119]/70 p-3"><p className="text-[10px] uppercase tracking-wide text-white/35">{label}</p><p className="mt-1 h-5 w-10 rounded bg-white/10" /></div>)}
              </div>
              <div className="rounded-xl p-3 text-sm font-medium" style={{ background: config.accent, color: onAccent }}>Nowa oferta dla gościa →</div>
              <p className="text-xs text-white/45">{servicesSource === 'loading' ? 'Wczytywanie katalogu usług…' : servicesSource === 'catalog' ? `Usługi z katalogu: ${servicesCount} (tylko podgląd, ceny poglądowe).` : 'Katalog jest pusty — pokaz użyje przykładowych usług.'}</p>
            </div>
          </div>
          <button type="button" onClick={onStart} disabled={servicesSource === 'loading'} className="mt-5 flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl text-lg font-medium transition-transform hover:scale-[1.01] disabled:opacity-50" style={{ background: config.accent, color: onAccent }}>
            <Play className="h-5 w-5" />Rozpocznij pokaz
          </button>
          <p className="mt-3 text-center text-xs text-white/40">Wskazówka: na tablecie włącz pełny ekran przyciskiem w prawym górnym rogu pokazu.</p>
        </aside>
      </div>
    </div>
  </div>;
}
