'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, HelpCircle, Search, X } from 'lucide-react';
import { helpChapter, searchHelp, type HelpAudience, type HelpChapter, type HelpManual } from '@/lib/help/helpTypes';
import { SELLER_HELP } from '@/lib/help/sellerHelp';
import { MANAGER_HELP } from '@/lib/help/managerHelp';

/**
 * Pomoc pod znakiem „?”: panel z boku ekranu z rozdziałem dla bieżącego ekranu.
 * Panel nie zasłania formularza na komputerze (bez przyciemnienia tła); na telefonie zajmuje cały ekran.
 * Otwierają go: przycisk „?” (HelpButton), podpowiedź przy polu („Więcej”), klawisz „?” poza polami tekstowymi.
 */

export const HELP_OPEN_EVENT = 'mavinci-help-open';
export const HELP_MANUALS: Record<HelpAudience, HelpManual> = { seller: SELLER_HELP, manager: MANAGER_HELP };

export function openHelp(audience: HelpAudience, chapter?: string) {
  window.dispatchEvent(new CustomEvent(HELP_OPEN_EVENT, { detail: { audience, chapter } }));
}

export function HelpButton({ audience, chapter, className = '' }: { audience: HelpAudience; chapter?: string; className?: string }) {
  return <button type="button" onClick={() => openHelp(audience, chapter)} aria-label="Pomoc — instrukcja dla tego ekranu" title="Pomoc (klawisz ?)"
    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#d3bb73] transition hover:bg-[#d3bb73]/10 focus-visible:bg-[#d3bb73]/15 focus-visible:outline-none ${className}`}>
    <HelpCircle className="h-5 w-5" aria-hidden="true" />
  </button>;
}

export function HelpChapterView({ chapter, headingLevel = 'h2' }: { chapter: HelpChapter; headingLevel?: 'h2' | 'h3' }) {
  const Heading = headingLevel;
  return <article className="space-y-4 text-sm leading-6 text-[#e5e4e2]/80">
    <div>
      <Heading className="text-base font-medium text-[#e5e4e2]">{chapter.title}</Heading>
      <p className="mt-1.5 text-[#e5e4e2]/70">{chapter.summary}</p>
    </div>
    {chapter.steps?.length ? <ol className="space-y-2">{chapter.steps.map((step, index) => <li key={step} className="flex gap-3">
      <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/10 text-xs text-[#d3bb73]">{index + 1}</span>
      <span>{step}</span>
    </li>)}</ol> : null}
    {chapter.notes?.length ? <div className="rounded-lg bg-white/[0.035] p-3">
      <p className="text-xs uppercase tracking-wide text-[#d3bb73]/80">Dobrze wiedzieć</p>
      <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[13px]">{chapter.notes.map((note) => <li key={note}>{note}</li>)}</ul>
    </div> : null}
    {chapter.faq?.length ? <div className="space-y-2">
      <p className="text-xs uppercase tracking-wide text-[#d3bb73]/80">Częste pytania</p>
      {chapter.faq.map((item) => <details key={item.q} className="rounded-lg bg-white/[0.025] px-3 py-2">
        <summary className="cursor-pointer text-[13px] text-[#e5e4e2]">{item.q}</summary>
        <p className="mt-2 text-[13px]">{item.a}</p>
      </details>)}
    </div> : null}
  </article>;
}

const typingTarget = (target: EventTarget | null) => target instanceof HTMLElement
  && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** Jeden na ekran: w layoucie portalu albo na ekranie CRM. */
export function HelpDrawerHost({ audience, defaultChapter, footer }: { audience: HelpAudience; defaultChapter?: string; footer?: ReactNode }) {
  const manual = HELP_MANUALS[audience];
  const fallback = defaultChapter || manual.chapters[0].id;
  const [open, setOpen] = useState(false);
  const [chapterId, setChapterId] = useState(fallback);
  const [query, setQuery] = useState('');
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const show = (chapter?: string) => {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setChapterId(chapter && manual.chapters.some((item) => item.id === chapter) ? chapter : fallbackRef.current);
      setQuery(''); setOpen(true);
    };
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ audience?: HelpAudience; chapter?: string }>).detail;
      if (detail?.audience === audience) show(detail.chapter);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '?' && !event.metaKey && !event.ctrlKey && !event.altKey && !typingTarget(event.target)) { event.preventDefault(); show(); }
    };
    window.addEventListener(HELP_OPEN_EVENT, onOpen);
    document.addEventListener('keydown', onKey);
    return () => { window.removeEventListener(HELP_OPEN_EVENT, onOpen); document.removeEventListener('keydown', onKey); };
  }, [audience, manual]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [chapterId]);

  const close = () => { setOpen(false); window.requestAnimationFrame(() => returnFocus.current?.focus()); };
  const results = useMemo(() => searchHelp(manual, query), [manual, query]);
  if (!open) return null;
  const chapter = helpChapter(manual, chapterId);
  const index = manual.chapters.indexOf(chapter);
  const previous = manual.chapters[index - 1];
  const next = manual.chapters[index + 1];

  return <>
    <button type="button" aria-label="Zamknij pomoc" onClick={close} className="fixed inset-0 z-[60] bg-black/50 lg:hidden" />
    <aside role="dialog" aria-modal="false" aria-labelledby={titleId}
      className="fixed inset-y-0 right-0 z-[61] flex w-full flex-col bg-[#171a29] text-[#e5e4e2] shadow-[-12px_0_40px_rgba(0,0,0,0.45)] sm:max-w-md">
      <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-[#d3bb73]">Pomoc</p>
          <p id={titleId} className="mt-1 text-sm text-white/55">{manual.title}</p>
        </div>
        <button ref={closeRef} type="button" onClick={close} aria-label="Zamknij pomoc" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white/55 hover:bg-white/5 hover:text-white">
          <X className="h-5 w-5" />
        </button>
      </header>
      <div className="space-y-3 px-5 pb-3">
        <label className="relative block"><span className="sr-only">Szukaj w instrukcji</span>
          <Search aria-hidden="true" className="absolute left-3 top-3 h-4 w-4 text-white/35" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj, np. prowizja, link, sala…"
            className="min-h-10 w-full rounded-lg border border-white/[0.06] bg-[#0f1119] py-2 pl-9 pr-3 text-sm outline-none focus:border-[#d3bb73]/30" />
        </label>
        {!query && <label className="block text-xs text-white/45">Rozdział
          <select value={chapter.id} onChange={(event) => setChapterId(event.target.value)}
            className="mt-1 min-h-10 w-full rounded-lg border border-white/[0.06] bg-[#0f1119] px-3 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/30">
            {manual.chapters.map((item, position) => <option key={item.id} value={item.id}>{position + 1}. {item.title}</option>)}
          </select>
        </label>}
      </div>
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
        {query ? <div className="space-y-2" aria-live="polite">
          {results.length ? results.map((item) => <button key={item.id} type="button" onClick={() => { setChapterId(item.id); setQuery(''); }}
            className="block w-full rounded-lg bg-white/[0.035] p-3 text-left hover:bg-white/[0.07]">
            <span className="block text-sm text-[#e5e4e2]">{item.title}</span>
            <span className="mt-1 block text-xs leading-5 text-white/50">{item.summary}</span>
          </button>) : <p className="p-3 text-sm text-white/50">Nic nie znaleziono. Spróbuj innego słowa{audience === 'seller' ? ' albo zapytaj opiekuna' : ''}.</p>}
        </div> : <>
          <HelpChapterView chapter={chapter} />
          <div className="mt-5 flex items-center justify-between gap-2 text-xs">
            {previous ? <button type="button" onClick={() => setChapterId(previous.id)} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-white/55 hover:bg-white/5 hover:text-white"><ChevronLeft className="h-4 w-4" />{previous.title}</button> : <span />}
            {next && <button type="button" onClick={() => setChapterId(next.id)} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-right text-white/55 hover:bg-white/5 hover:text-white">{next.title}<ChevronRight className="h-4 w-4" /></button>}
          </div>
        </>}
      </div>
      {footer && <footer className="flex flex-wrap gap-2 border-t border-white/[0.05] px-5 py-4" onClick={(event) => { if ((event.target as HTMLElement).closest('a')) setOpen(false); }}>{footer}</footer>}
    </aside>
  </>;
}

/** „?” przy trudnym pojęciu: jedno–dwa zdania i „Więcej” otwierające rozdział w panelu. */
export function HelpTip({ audience, tip, label }: { audience: HelpAudience; tip: string; label?: string }) {
  const content = HELP_MANUALS[audience].tips[tip];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', onKey); };
  }, [open]);
  if (!content) return null;
  return <span ref={ref} className="relative inline-flex align-middle">
    <button type="button" aria-expanded={open} aria-controls={id} aria-label={label ? `Co to znaczy: ${label}` : 'Wyjaśnienie'} onClick={() => setOpen((value) => !value)}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[#d3bb73]/80 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]">
      <HelpCircle className="h-4 w-4" aria-hidden="true" />
    </button>
    {open && <span id={id} role="note" className="absolute left-1/2 top-7 z-40 w-72 -translate-x-1/2 rounded-lg bg-[#232741] p-3 text-left text-xs font-normal normal-case leading-5 tracking-normal text-[#e5e4e2]/85 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
      {content.text}
      <button type="button" onClick={() => { setOpen(false); openHelp(audience, content.chapter); }} className="mt-2 block text-[#d3bb73] underline-offset-4 hover:underline">Więcej w instrukcji</button>
    </span>}
  </span>;
}
