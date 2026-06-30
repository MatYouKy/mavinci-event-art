import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

export default function CasinoCityIntro({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';

  const heading =
    content?.intro_heading ||
    `Kasyno rozrywkowe ${prep} ${capitalize(cityCases.locative)}`;

  const text =
    content?.intro_text ||
    `Organizujemy profesjonalne kasyno rozrywkowe na eventy firmowe ${prep} ${capitalize(cityCases.locative)} i okolicach. Dostarczamy autentyczne stoły do gier kasynowych - ruletkę, blackjacka, pokera Texas Hold'em, koło fortuny i kości. Nasi doświadczeni krupierzy zapewniają niezapomnianą atmosferę Las Vegas na każdej imprezie. Kompletna oprawa kasynowa: dekoracje, oświetlenie, muzyka i profesjonalne żetony dla każdego gościa.`;

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
