import { Sparkles, Music, Camera, Palette, Users, Trophy } from 'lucide-react';
import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

const defaultServices = [
  {
    icon: 'Sparkles',
    title: 'Casino Night',
    description:
      'Profesjonalne stoły do ruletki, blackjacka, pokera i kości. Krupierzy w strojach, żetony, dekoracje w stylu Las Vegas. Pełna atmosfera kasyna na Twoim evencie.',
  },
  {
    icon: 'Music',
    title: 'Lata 20-te / Great Gatsby',
    description:
      'Elegancki wieczór w stylu art deco - jazz band na żywo, charleston, cocktail bar, złote dekoracje. Dress code: fraki i suknie z frędzlami.',
  },
  {
    icon: 'Camera',
    title: 'Hollywood & Gala Oscarowa',
    description:
      'Czerwony dywan, paparazzi, ceremonia wręczenia nagród, fotobudka z rekwizytami filmowymi. Gwiazdy wieczoru to Twoi goście.',
  },
  {
    icon: 'Palette',
    title: 'PRL / Lata 70-80',
    description:
      'Bar mleczny, dekoracje z epoki, muzyka disco polo i rock, quizy z wiedzy o PRL, konkursy taneczne. Nostalgiczna podróż w czasie.',
  },
  {
    icon: 'Users',
    title: 'Dziki Zachód / Western',
    description:
      'Saloon, rodeo mechaniczne, pokazy lasso, strzelnica, country music na żywo. Kowbojski klimat z pełną scenografią.',
  },
  {
    icon: 'Trophy',
    title: 'Tropikalna Fiesta / Hawaje',
    description:
      'Egzotyczne dekoracje, bary tiki, pokazy ognia, limbo, konkursy plażowe, cocktaile z parasolkami. Wakacyjny klimat niezależnie od pory roku.',
  },
];

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Sparkles,
  Music,
  Camera,
  Palette,
  Users,
  Trophy,
};

export default function ThemedPartyCityServices({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';
  const heading =
    content?.services_heading ||
    `Motywy wieczorów tematycznych ${prep} ${capitalize(cityCases.locative)}`;

  const services =
    content?.services_json && Array.isArray(content.services_json) && content.services_json.length > 0
      ? content.services_json
      : defaultServices;

  return (
    <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <h2 className="mb-4 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          {heading}
        </h2>
        <p className="mx-auto mb-12 max-w-3xl text-center text-[#e5e4e2]/60">
          Wybierz motyw przewodni lub zaproponuj własny - każdy wieczór tworzymy od podstaw
        </p>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service: any, idx: number) => {
            const IconComp = iconMap[service.icon] || Sparkles;
            return (
              <div
                key={idx}
                className="group rounded-xl border border-[#d3bb73]/10 bg-[#0f1119] p-6 transition-all duration-300 hover:border-[#d3bb73]/40 hover:shadow-lg hover:shadow-[#d3bb73]/5"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[#d3bb73]/10 transition-colors group-hover:bg-[#d3bb73]/20">
                  <IconComp className="h-6 w-6 text-[#d3bb73]" />
                </div>
                <h3 className="mb-2 text-lg font-medium text-[#e5e4e2]">{service.title}</h3>
                <p className="text-sm leading-relaxed text-[#e5e4e2]/70">{service.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
