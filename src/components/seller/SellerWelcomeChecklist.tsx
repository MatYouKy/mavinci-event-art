'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, ListChecks, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import type { SellerPortalContext } from '@/lib/seller/portal';
import { readSellerWelcome, SELLER_WELCOME_CHANGED_EVENT, writeSellerWelcome, type SellerWelcomeFlags } from '@/lib/seller/welcome';

/** First steps for a new seller; hides when every step is done or when dismissed. */
export default function SellerWelcomeChecklist({ context, offerCount }: { context: SellerPortalContext; offerCount: number }) {
  const partnerId = context.profile.id;
  const [flags, setFlags] = useState<SellerWelcomeFlags | null>(null);
  const [activity, setActivity] = useState<{ inquiries: number; links: number } | null>(null);

  useEffect(() => {
    const sync = () => setFlags(readSellerWelcome(partnerId));
    sync();
    window.addEventListener(SELLER_WELCOME_CHANGED_EVENT, sync);
    return () => window.removeEventListener(SELLER_WELCOME_CHANGED_EVENT, sync);
  }, [partnerId]);
  const visible = Boolean(flags && !flags.dismissed);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    void (async () => {
      const [inquiries, links] = await Promise.all([
        supabase.rpc('get_seller_inquiries', { p_limit: 1 }),
        supabase.rpc('get_seller_inquiry_links'),
      ]);
      if (!active) return;
      setActivity({
        inquiries: Array.isArray(inquiries.data) ? inquiries.data.length : 0,
        links: Array.isArray(links.data) ? links.data.length : 0,
      });
    })().catch(() => { if (active) setActivity({ inquiries: 0, links: 0 }); });
    return () => { active = false; };
  }, [visible, partnerId]);

  if (!flags || flags.dismissed) return null;
  const branded = context.brands.some((brand) => Boolean(brand.branding?.organization_branding_configured || brand.branding?.hotel_logo_url));
  const steps = [
    { id: 'branding', label: 'Ustaw branding ofert', detail: 'Logo i kolory hotelu pojawią się w PDF i na stronie oferty dla gościa.', href: '/seller/profile?tab=branding', done: branded },
    { id: 'manager', label: 'Poznaj swojego opiekuna', detail: 'Zapisz kontakt i napisz pierwszą wiadomość.', href: '/seller/messages', done: Boolean(flags.manager) },
    { id: 'first', label: 'Wyślij pierwsze zapytanie lub ofertę', detail: 'Zacznij od „Sprawdź termin” albo od razu przygotuj ofertę.', href: offerCount ? '/seller/offers' : '/seller/inquiries', done: offerCount > 0 || Boolean(activity?.inquiries) },
    { id: 'qr', label: 'Przygotuj materiały QR', detail: 'Wydrukuj kartę z kodem QR — goście sami wyślą zapytanie.', href: '/seller/materials', done: Boolean(activity?.links) },
  ];
  const doneCount = steps.filter((step) => step.done).length;
  if (activity && doneCount === steps.length) return null;
  const dismiss = () => setFlags(writeSellerWelcome(partnerId, { dismissed: true }));
  const markManager = (id: string) => { if (id === 'manager') setFlags(writeSellerWelcome(partnerId, { manager: true })); };

  return <section aria-labelledby="seller-welcome-title" className="rounded-xl bg-gradient-to-br from-[#d3bb73]/[0.12] to-[#1c1f33] p-5 text-[#e5e4e2]">
    <div className="flex items-start justify-between gap-3">
      <div><p className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[#d3bb73]"><ListChecks className="h-4 w-4" />Pierwsze kroki · {doneCount}/{steps.length}</p>
        <h2 id="seller-welcome-title" className="mt-2 text-lg font-light">Witaj w portalu MAVINCI</h2>
        <p className="mt-1 text-sm text-white/55">Cztery kroki, po których sprzedaż wydarzeń pójdzie sprawnie.</p></div>
      <button type="button" onClick={dismiss} aria-label="Ukryj listę pierwszych kroków" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white/50 hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button>
    </div>
    <ol className="mt-4 grid gap-2 sm:grid-cols-2">{steps.map((step, index) => <li key={step.id}>
      <Link href={step.href} onClick={() => markManager(step.id)} className={`flex min-h-16 items-start gap-3 rounded-lg p-3 transition ${step.done ? 'bg-emerald-300/[0.07]' : 'bg-black/15 hover:bg-black/25'}`}>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${step.done ? 'bg-emerald-300/20 text-emerald-200' : 'bg-[#d3bb73]/15 text-[#d3bb73]'}`}>{step.done ? <Check className="h-4 w-4" aria-label="Zrobione" /> : index + 1}</span>
        <span className="min-w-0"><span className={`block text-sm ${step.done ? 'text-white/55 line-through decoration-white/25' : ''}`}>{step.label}</span><span className="mt-0.5 block text-xs leading-5 text-white/45">{step.detail}</span></span>
      </Link>
    </li>)}</ol>
  </section>;
}
