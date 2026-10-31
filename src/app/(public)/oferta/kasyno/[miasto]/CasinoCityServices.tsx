import { Dice1, Users, Crown, CircleDot, Star, Sparkles } from 'lucide-react';
import Link from 'next/link';
import type { CasinoService } from '@/lib/SEO/casinoCityContent';
import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
  services: CasinoService[];
};

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Dice1,
  Crown,
  Users,
  CircleDot,
  Star,
  Sparkles,
};

export default function CasinoCityServices({ cityCases, content, services }: Props) {
  const prep = cityCases.locative_preposition || 'w';
  const heading =
    content?.services_heading ||
    `Gry kasynowe ${prep} ${capitalize(cityCases.locative)}`;

  return (
    <section id="stoly-kasynowe" className="scroll-mt-24 bg-[#291320]/40 px-5 py-14 sm:px-6 md:py-20">
      <div className="mx-auto max-w-7xl">
        <h2 className="mb-4 text-center text-3xl font-light uppercase text-[#e5e4e2] md:text-4xl">
          {heading}
        </h2>
        <p className="mx-auto mb-12 max-w-3xl text-center text-[#e5e4e2]/60">
          Poznaj gry i dobierz stoły do programu. Liczbę stanowisk, obsadę krupierską i czas zabawy ustalamy w ofercie.
        </p>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service, idx) => {
            const IconComp = iconMap[service.icon || 'Dice1'] || Dice1;
            return (
              <article
                key={idx}
                className="group flex min-w-0 flex-col overflow-hidden rounded-2xl bg-white/[0.04]"
              >
                {service.image && <picture className="overflow-hidden">
                  {service.mobileImage && <source media="(max-width: 767px)" srcSet={service.mobileImage} />}
                  <img src={service.image} alt={service.alt || service.title} width={960} height={600} loading="lazy" decoding="async"
                    className="aspect-[16/10] w-full object-cover motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-[1.02]" />
                </picture>}
                <div className="flex flex-1 flex-col p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[#d3bb73]/10 transition-colors group-hover:bg-[#d3bb73]/20">
                  <IconComp className="h-6 w-6 text-[#d3bb73]" />
                </div>
                <h3 className="mb-2 text-lg font-medium uppercase text-[#e5e4e2]">{service.title}</h3>
                <p className="text-sm leading-relaxed text-[#e5e4e2]/70">{service.description}</p>
                {service.href && <Link href={service.href} className="mt-auto inline-flex min-h-12 items-center pt-5 text-sm text-[#d3bb73] underline underline-offset-4">Poznaj ten element strefy</Link>}
                {service.slug && ['blackjack', 'poker', 'ruletka'].includes(service.slug) && <Link href={`/oferta/kasyno/zasady/${service.slug}`} className="mt-2 inline-flex min-h-11 items-center text-sm text-white/70 underline underline-offset-4">Jak wygląda gra?</Link>}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
