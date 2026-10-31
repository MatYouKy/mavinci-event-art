import 'server-only';
import Image from 'next/image';
import Link from 'next/link';
import type { PolishCityCases } from '@/lib/polishCityCases';

type Props = { themes: { title: string; description: string; image?: string; scenarioHref?: string }[]; cityCases: PolishCityCases };

export default function ThemedPartyCityThemes({ themes, cityCases }: Props) {
  if (!themes.length) return null;
  return <section id="motywy" className="bg-[#291320]/60 px-5 py-14 sm:px-6 md:py-20">
    <div className="mx-auto max-w-7xl">
      <h2 className="text-2xl font-light uppercase leading-snug sm:text-3xl">Pomysły na wieczór tematyczny dla firmy</h2>
      <p className="mt-5 max-w-3xl leading-7 text-white/75">Wybierz klimat imprezy {cityCases.locative_preposition || 'w'} {cityCases.locative}. Poniższe opisy pokazują możliwości programu; dekoracje, atrakcje i wyposażenie dobieramy do sali, liczby gości oraz budżetu.</p>
      <div className="mt-9 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {themes.map((theme, index) => <article key={`${theme.title}-${index}`} className="group overflow-hidden rounded-2xl bg-[#190f1b] shadow-sm">
          {theme.image && <div className="relative aspect-[16/10] overflow-hidden">
            <Image src={theme.image} alt={`Motyw wieczoru: ${theme.title}`} fill sizes="(max-width: 639px) calc(100vw - 40px), (max-width: 1279px) 50vw, 400px" className="object-cover motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-[1.02]" loading="lazy" />
          </div>}
          <div className="p-6"><h3 className="text-lg leading-7 text-[#d3bb73]">{theme.title}</h3><p className="mt-3 text-sm leading-6 text-white/75">{theme.description}</p>
            {theme.scenarioHref && <Link href={theme.scenarioHref} className="mt-4 inline-flex min-h-11 items-center text-sm text-[#d3bb73] underline underline-offset-4">Poznaj program i zobacz realizacje ↗</Link>}
            {/las vegas|james bond/i.test(theme.title) && <Link href="/oferta/kasyno" className="mt-4 inline-flex min-h-11 items-center text-sm text-[#d3bb73] underline underline-offset-4">Zobacz zasady kasyna rozrywkowego</Link>}
          </div>
        </article>)}
      </div>
    </div>
  </section>;
}
