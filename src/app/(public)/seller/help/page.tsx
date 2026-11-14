'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { MessageSquare, Search } from 'lucide-react';
import { HelpChapterView } from '@/components/help/HelpDrawer';
import { searchHelp } from '@/lib/help/helpTypes';
import { SELLER_HELP } from '@/lib/help/sellerHelp';
import { SELLER_JOURNEY_STAGES } from '@/lib/seller/offerJourney';

/** Pełna instrukcja sprzedawcy — ta sama treść co panel „?”. */
export default function SellerHelpPage() {
  const [query, setQuery] = useState('');
  const chapters = useMemo(() => searchHelp(SELLER_HELP, query), [query]);
  return <div className="min-h-screen p-4 text-[#e5e4e2] md:p-6">
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-2xl font-light uppercase">Instrukcja sprzedawcy</h1>
          <p className="mt-1 max-w-2xl text-sm text-white/55">Jak przygotować ofertę, przekazać ją klientowi i doprowadzić do wydarzenia. Na każdym ekranie tę samą pomoc otworzysz znakiem „?”.</p></div>
        <Link href="/seller/messages" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#111522]"><MessageSquare className="h-4 w-4" />Zapytaj opiekuna</Link>
      </header>

      <section aria-labelledby="help-axis-title" className="rounded-xl bg-[#1c1f33] p-4 sm:p-5">
        <h2 id="help-axis-title" className="text-base font-medium">Pięć etapów każdej oferty</h2>
        <ol className="mt-4 grid gap-2 sm:grid-cols-5">{SELLER_JOURNEY_STAGES.map((stage, index) => <li key={stage.key} className="rounded-lg bg-white/[0.035] p-3">
          <span className="block h-1.5 rounded-full bg-[#d3bb73]/60" aria-hidden="true" />
          <p className="mt-2 text-sm text-[#d3bb73]">{index + 1}. {stage.label}</p>
          <p className="mt-1 text-xs leading-5 text-white/55">{stage.hint}</p>
        </li>)}</ol>
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Rozdziały instrukcji" className="space-y-3 rounded-xl bg-[#1c1f33] p-4 lg:sticky lg:top-4">
          <label className="relative block"><span className="sr-only">Szukaj w instrukcji</span>
            <Search aria-hidden="true" className="absolute left-3 top-3 h-4 w-4 text-white/35" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj…"
              className="min-h-10 w-full rounded-lg border border-white/[0.06] bg-[#0f1119] py-2 pl-9 pr-3 text-sm outline-none focus:border-[#d3bb73]/30" />
          </label>
          <ol className="space-y-1 text-sm">{chapters.map((chapter) => <li key={chapter.id}>
            <a href={`#${chapter.id}`} className="block rounded-lg px-3 py-2 text-white/65 hover:bg-white/5 hover:text-white">{SELLER_HELP.chapters.indexOf(chapter) + 1}. {chapter.title}</a>
          </li>)}</ol>
        </nav>
        <div className="min-w-0 space-y-4">
          {chapters.map((chapter) => <section key={chapter.id} id={chapter.id} className="scroll-mt-6 rounded-xl bg-[#1c1f33] p-4 sm:p-6">
            <HelpChapterView chapter={chapter} />
          </section>)}
          {!chapters.length && <p className="rounded-xl bg-[#1c1f33] p-6 text-sm text-white/55">Nic nie znaleziono. Spróbuj innego słowa albo zapytaj opiekuna.</p>}
        </div>
      </div>
    </div>
  </div>;
}
