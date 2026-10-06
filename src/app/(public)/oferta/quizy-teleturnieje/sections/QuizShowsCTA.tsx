import { ArrowRight, Mail, Phone } from 'lucide-react';
import { SITE } from '@/lib/SEO/site';

export default function QuizShowsCTA({ location }: { location?: string }) {
  return <section id="zapytaj-o-teleturniej" className="scroll-mt-24 bg-[#30131f] px-5 py-14 sm:px-6 lg:py-20"><div className="mx-auto max-w-5xl">
    <p className="quiz-eyebrow">Zaplanujmy Waszą rozgrywkę</p>
    <h2 className="quiz-heading">Dobierz teleturniej do swojego wydarzenia{location ? ` ${location}` : ''}</h2>
    <p className="mt-5 max-w-3xl leading-relaxed text-white/75">Podaj termin, miejsce, liczbę gości i czas przeznaczony na zabawę. Jeśli masz już temat wieczoru lub wybrany format, dopisz go w wiadomości. Na tej podstawie ustalimy scenariusz i potrzebną technikę.</p>
    <div className="mt-7 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <a href="/#kontakt" className="quiz-button-primary">Zapytaj o teleturniej <ArrowRight size={18} /></a>
      <a href={SITE.phoneHref} className="quiz-button-secondary"><Phone size={18} />{SITE.telephone}</a>
      <a href={`mailto:${SITE.email}?subject=${encodeURIComponent('Zapytanie o quiz / teleturniej firmowy')}`} className="quiz-button-secondary"><Mail size={18} />{SITE.email}</a>
    </div>
    <p className="mt-7 text-sm text-white/60">Olsztyn · Warmia i Mazury · realizacje w całej Polsce</p>
  </div></section>;
}
