'use client';

import { useEffect, useState } from 'react';
import { useAppDispatch } from '@/store/hooks';
import { fetchCustomIcons } from '@/store/slices/customIconSlice';
import { ArrowRight, Edit2, Plus, Gamepad2 } from 'lucide-react';
import { SITE } from '@/lib/SEO/site';
import { isQuizStockImage, quizImageSrcSet, safeQuizLink, type QuizShowFormat } from '@/lib/quiz-shows/types';
import { useQuizShowFormats } from '@/hooks/useQuizShowFormats';
import { useWebsiteEdit } from '@/hooks/useWebsiteEdit';
import { CustomIcon } from '@/components/UI/CustomIcon/CustomIcon';
import QuizFormatEditModal from './QuizFormatEditModal';

export default function QuizShowsTypes({ initialFormats }: { initialFormats: QuizShowFormat[] }) {
  const { canEdit } = useWebsiteEdit();
  const dispatch = useAppDispatch();
  useEffect(() => { void dispatch(fetchCustomIcons()); }, [dispatch, canEdit]);
  const { formats, error, refetch, loading } = useQuizShowFormats(initialFormats, canEdit);
  const [editing, setEditing] = useState<QuizShowFormat | null>(null);
  const [adding, setAdding] = useState(false);
  const visible = formats.filter(format => canEdit || format.is_visible);
  return <section id="formaty" className="scroll-mt-24 px-5 py-12 sm:px-6 lg:py-20" aria-labelledby="quiz-formats-title">
    <div className="mx-auto max-w-7xl">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5 lg:mb-12">
        <div className="max-w-2xl"><p className="quiz-eyebrow">Wybierz sposób rozgrywki</p>
          <h2 id="quiz-formats-title" className="quiz-heading">Jaki teleturniej pasuje do Twojego wieczoru?</h2>
          <p className="mt-4 leading-relaxed text-white/70">Przy stolikach, na scenie lub z udziałem całej sali. Format dobieramy do gości, czasu i miejsca w programie.</p>
        </div>
        {canEdit && <button onClick={() => setAdding(true)} className="quiz-button-secondary"><Plus size={18} /> Dodaj format</button>}
      </div>
      {error && <div role="status" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl bg-white/5 p-4 text-sm">{error}<button disabled={loading} onClick={() => void refetch()} className="text-[#d3bb73] underline">Odśwież</button></div>}
      <div className="space-y-6 lg:space-y-10">
        {visible.map((format, index) => {
          const stock = isQuizStockImage(format.image_url);
          const photo = format.image_url && (!stock || canEdit) ? format.image_url : null;
          const href = safeQuizLink(format.link_url);
          const mail = `mailto:${SITE.email}?subject=${encodeURIComponent(`Teleturniej: ${format.title}`)}`;
          return <article key={format.id} className="quiz-format group relative grid overflow-hidden rounded-2xl bg-[#25131c] lg:grid-cols-2">
            <div className={`relative aspect-[16/10] bg-[#301721] lg:aspect-auto lg:min-h-[320px] ${format.layout_direction === 'right' ? 'lg:order-2' : ''}`}>
              {photo ? <img src={photo} srcSet={quizImageSrcSet(photo)} sizes="(min-width: 1024px) 50vw, 100vw" loading="lazy" decoding="async" alt={format.title} width={1280} height={800} className="h-full w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-[1.025]" /> :
                <div className="quiz-format-art absolute inset-0 flex flex-col justify-between p-6 sm:p-9" aria-hidden="true">
                  <span className="text-sm tracking-[0.25em] text-[#d3bb73]/70">MAVINCI / QUIZ SHOW</span>
                  <div className="flex items-end justify-between"><span className="text-7xl font-light text-[#d3bb73]/35 sm:text-8xl">{String(index + 1).padStart(2, '0')}</span><Gamepad2 className="h-16 w-16 text-[#d3bb73]/60" strokeWidth={1} /></div>
                </div>}
              {stock && canEdit && <span className="absolute bottom-3 left-3 right-3 rounded-lg bg-black/80 p-3 text-xs">Zdjęcie przykładowe. Dodaj własną realizację — publicznie pokazujemy grafikę zastępczą.</span>}
            </div>
            <div className="flex min-w-0 flex-col p-6 sm:p-8 lg:p-10">
              <div className="mb-5 flex items-center gap-3 text-[#d3bb73]">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#d3bb73]/10"><CustomIcon iconId={format.icon_id} className="h-6 w-6" fallback={<Gamepad2 size={24} />} /></span>
                <span className="text-sm">{format.level}</span>
                {!format.is_visible && <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">Ukryty</span>}
              </div>
              <h3 className="break-words text-xl uppercase leading-snug sm:text-2xl">{format.title}</h3>
              <p className="mt-4 leading-relaxed text-white/75">{format.description}</p>
              <ul className="mt-5 space-y-2 text-sm leading-relaxed text-white/75">{format.features.map((feature, i) => <li key={i} className="flex gap-3"><span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d3bb73]" />{feature}</li>)}</ul>
              <div className="mt-auto flex flex-wrap items-center gap-5 pt-6">
                <a href={mail} className="inline-flex min-h-11 items-center gap-2 text-sm text-[#d3bb73] hover:text-white">Zapytaj o ten format <ArrowRight size={17} /></a>
                {href && <a href={href} className="text-sm text-white/70 underline underline-offset-4">Szczegóły formatu</a>}
                {canEdit && <button onClick={() => setEditing(format)} className="quiz-button-secondary" aria-label={`Edytuj: ${format.title}`}><Edit2 size={16} /> Edytuj</button>}
              </div>
            </div>
          </article>;
        })}
      </div>
      {!visible.length && <p className="rounded-2xl bg-white/5 p-6 text-white/70">Dobierzemy formułę do planu wydarzenia. Opisz termin, miejsce i liczbę uczestników w zapytaniu.</p>}
    </div>
    {(editing || adding) && <QuizFormatEditModal format={editing || undefined} onSaved={async () => { await refetch(); await dispatch(fetchCustomIcons()); }} onClose={() => { setEditing(null); setAdding(false); }} />}
  </section>;
}
