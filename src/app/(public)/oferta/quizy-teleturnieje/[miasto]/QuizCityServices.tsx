import { Gamepad2, Users, Music, Smartphone, Sparkles, Trophy } from 'lucide-react';
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
    icon: 'Trophy',
    title: 'Teleturniej telewizyjny',
    description:
      'Profesjonalny teleturniej w stylu programów TV. Familiada, Milionerzy, Jeopardy, Jeden z dziesięciu. Scenografia studyjna, oświetlenie, prowadzący z TV.',
  },
  {
    icon: 'Users',
    title: 'Quiz firmowy i integracyjny',
    description:
      'Quizy tematyczne dopasowane do firmy, branży i zespołu. Pytania o firmie, produktach, historii. Rywalizacja drużynowa z tablicą wyników live.',
  },
  {
    icon: 'Gamepad2',
    title: 'Gry zespołowe i team building',
    description:
      'Escape room live, gry planszowe XXL, challenge technologiczne, gry miejskie, kreatywne warsztaty. Budowanie współpracy przez zabawę.',
  },
  {
    icon: 'Music',
    title: 'Karaoke show i muzyczne gry',
    description:
      'Karaoke z profesjonalnym PA, Name That Tune, muzyczne quizy, lip sync battle, disco bingo. DJ i prowadzący z animacją.',
  },
  {
    icon: 'Smartphone',
    title: 'Quizy multimedialne na smartfonach',
    description:
      'Interaktywne quizy na telefonach uczestników. Głosowanie w czasie rzeczywistym, ranking live, multimedia, zdjęcia i wideo w pytaniach.',
  },
  {
    icon: 'Sparkles',
    title: 'Wieczory tematyczne',
    description:
      'Eventy tematyczne: kryminalne, PRL, lata 80., filmowe, sportowe. Kompletna oprawa: scenografia, kostiumy, rekwizyty, catering tematyczny.',
  },
];

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Trophy,
  Users,
  Gamepad2,
  Music,
  Smartphone,
  Sparkles,
};

export default function QuizCityServices({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';
  const heading =
    content?.services_heading ||
    `Formaty quizowe i gry ${prep} ${capitalize(cityCases.locative)}`;

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
          Autorskie formaty rozrywkowe dopasowane do każdego zespołu i okazji
        </p>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service: any, idx: number) => {
            const IconComp = iconMap[service.icon] || Trophy;
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
