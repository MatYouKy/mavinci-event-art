import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
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
    `Mobilne kasyno na firmowy wieczór ${prep} ${capitalize(cityCases.locative)}. Dobierz stoły do blackjacka, pokera i ruletki oraz uzgodnij zakres obsługi i oprawy. Program, transport i warunki realizacji potwierdzamy w indywidualnej ofercie.`;

  return (
    <section className="px-5 py-12 sm:px-6 md:py-16">
      <div className="mx-auto max-w-5xl">
        <h2 className="mb-8 text-center text-3xl font-light uppercase text-[#e5e4e2] md:text-4xl">
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
