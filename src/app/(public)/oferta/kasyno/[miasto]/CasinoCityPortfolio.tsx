import 'server-only';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { CasinoReference } from '@/lib/SEO/casinoReferences.server';

export default function CasinoCityPortfolio({ projects }: { projects: CasinoReference[] }) {
  if (!projects.length) return null;
  return <section id="realizacje-kasyna" className="scroll-mt-24 px-5 py-14 text-[#e5e4e2] sm:px-6 md:py-20">
    <div className="mx-auto max-w-7xl">
      <p className="text-sm text-[#d3bb73]">Poznaj nasze doświadczenie</p>
      <h2 className="mt-3 text-3xl font-light uppercase sm:text-4xl">Kasyno w realizacjach MAVINCI</h2>
      <p className="mt-5 max-w-3xl leading-7 text-white/70">Zobacz wydarzenia, w których strefa kasyna była częścią programu. Pokazują możliwości połączenia stołów, muzyki, scenografii i techniki — zakres Twojego eventu ustalimy indywidualnie.</p>
      <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {projects.map(project => <article key={project.id} className="group flex min-w-0 flex-col overflow-hidden rounded-2xl bg-white/[0.04]">
          {project.image && <Link href={project.href} tabIndex={-1} aria-hidden="true" className="overflow-hidden">
            <picture>
              {project.mobileImage && <source media="(max-width: 767px)" srcSet={project.mobileImage} />}
              <img src={project.image} alt="" width={960} height={600} loading="lazy" decoding="async"
                className="aspect-[16/10] w-full object-cover motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-[1.02]" />
            </picture>
          </Link>}
          <div className="flex flex-1 flex-col p-6">
            {project.location && <p className="mb-3 text-xs text-[#d3bb73]">Miejsce realizacji: {project.location}</p>}
            <h3 className="text-xl uppercase"><Link href={project.href} className="hover:text-[#d3bb73]">{project.title}</Link></h3>
            <p className="mt-4 whitespace-pre-line text-sm leading-7 text-white/70">{project.description}</p>
            <Link href={project.href} className="mt-auto inline-flex min-h-12 items-center gap-2 pt-5 text-sm text-[#d3bb73] underline underline-offset-4">Zobacz realizację <ArrowUpRight size={18} aria-hidden="true" /></Link>
          </div>
        </article>)}
      </div>
    </div>
  </section>;
}
