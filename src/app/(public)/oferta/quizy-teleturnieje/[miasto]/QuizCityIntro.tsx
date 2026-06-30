import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

export default function QuizCityIntro({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';

  const heading =
    content?.intro_heading ||
    `Quizy i teleturnieje ${prep} ${capitalize(cityCases.locative)}`;

  const text =
    content?.intro_text ||
    `Organizujemy profesjonalne quizy, teleturnieje i gry integracyjne ${prep} ${capitalize(cityCases.locative)} i okolicach. Nasze autorskie formaty łączą rozrywkę telewizyjną z integracją zespołową - od klasycznych teleturniejów w stylu Familiady czy Milionerów, przez interaktywne quizy na smartfonach, po zaawansowane gry zespołowe i escape roomy live. Zapewniamy kompletną produkcję: scenografię, oświetlenie, nagłośnienie, ekrany LED, system buzzers i profesjonalnego prowadzącego z doświadczeniem TV.`;

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
