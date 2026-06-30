import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

export default function TechStageCityIntro({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';

  const heading =
    content?.intro_heading ||
    `Profesjonalna technika sceniczna ${prep} ${capitalize(cityCases.locative)}`;

  const text =
    content?.intro_text ||
    `Zapewniamy kompleksową obsługę techniczną wydarzeń ${prep} ${capitalize(cityCases.locative)} i okolicach. Dostarczamy profesjonalne nagłośnienie koncertowe i konferencyjne, oświetlenie sceniczne i architekturalne, ekrany LED i multimedia, konstrukcje sceniczne oraz rigging. Nasz zespół certyfikowanych techników i inżynierów dźwięku zapewnia pełne wsparcie - od projektu technicznego i rideru, przez montaż i konfigurację, po realizację podczas wydarzenia i demontaż. Pracujemy na własnym sprzęcie renomowanych marek: L-Acoustics, d&b audiotechnik, MA Lighting, Robe, Clay Paky.`;

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
