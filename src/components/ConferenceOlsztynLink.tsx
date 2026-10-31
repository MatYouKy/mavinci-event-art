import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { OLSZTYN_CONFERENCE_PATH } from '@/lib/SEO/conferenceOverview';

const descriptions = {
  portfolio: 'Planujesz konferencję w Olsztynie lub okolicach? Zobacz zakres obsługi, nasze zaplecze przy ul. Towarowej 20B i informacje potrzebne do przygotowania wyceny.',
  service: 'Potrzebujesz tej usługi podczas konferencji w Olsztynie? Połącz wybrany zakres z nagłośnieniem, obrazem, światłem i pracą realizatorów. Uzgodnimy wyposażenie sali oraz plan montażu i prób.',
  streaming: 'Organizujesz konferencję hybrydową w Olsztynie? Możemy połączyć transmisję dla uczestników online z nagłośnieniem, prezentacjami i obsługą techniczną na sali.',
};

export default function ConferenceOlsztynLink({ context }: { context: keyof typeof descriptions }) {
  return (
    <aside className="px-5 py-8 sm:px-6 md:py-12" aria-labelledby="olsztyn-conference-link-heading">
      <div className="mx-auto grid max-w-5xl gap-5 rounded-2xl bg-[#29121f] p-6 sm:p-8 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <h2 id="olsztyn-conference-link-heading" className="text-xl font-light uppercase text-[#e5e4e2] sm:text-2xl">Zaplanuj konferencję w Olsztynie</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75 sm:text-base sm:leading-7">{descriptions[context]}</p>
        </div>
        <Link href={OLSZTYN_CONFERENCE_PATH} prefetch={false} className="group inline-flex min-h-12 items-center justify-between gap-4 rounded-xl bg-white/[0.06] px-5 py-4 text-sm leading-6 text-[#d3bb73] transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d3bb73]/50 md:max-w-64">
          Obsługa techniczna konferencji w Olsztynie
          <ArrowUpRight size={20} aria-hidden="true" className="shrink-0 motion-safe:transition-transform motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:translate-x-0.5" />
        </Link>
      </div>
    </aside>
  );
}
