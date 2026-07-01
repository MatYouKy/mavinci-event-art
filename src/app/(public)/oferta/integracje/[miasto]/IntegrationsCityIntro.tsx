import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

export default function IntegrationsCityIntro({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';

  const heading =
    content?.intro_heading ||
    `Integracje firmowe ${prep} ${capitalize(cityCases.locative)} - profesjonalny team building`;

  const text =
    content?.intro_text ||
    `Organizujemy kompleksowe integracje firmowe i eventy team buildingowe ${prep} ${capitalize(cityCases.locative)} i okolicach. Od kameralnych spotkań dla 10 osób po duże eventy korporacyjne na 500+ uczestników. Gry terenowe, scenariusze fabularne, zadania zespołowe outdoor i indoor - budujemy zespoły przez wspólne doświadczenia.\n\nNasi doświadczeni animatorzy i koordynatorzy eventów zapewnią profesjonalną realizację integracji ${prep} ${capitalize(cityCases.locative)}. Każdy scenariusz projektujemy indywidualnie, dopasowując format i poziom aktywności do celów klienta i profilu grupy.`;

  return (
    <section className="border-b border-[#d3bb73]/10 px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="mb-8 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          {heading}
        </h2>
        <div className="space-y-6 text-lg leading-relaxed text-[#e5e4e2]/80">
          {text.split('\n').map((paragraph: string, idx: number) => (
            <p key={idx}>{paragraph}</p>
          ))}
        </div>
      </div>
    </section>
  );
}
