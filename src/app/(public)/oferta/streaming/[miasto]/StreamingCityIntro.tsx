import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

export default function StreamingCityIntro({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';

  const heading =
    content?.intro_heading ||
    `Profesjonalny streaming i transmisje live ${prep} ${capitalize(cityCases.locative)}`;

  const text =
    content?.intro_text ||
    `Realizujemy transmisje na żywo z wydarzeń biznesowych, konferencji, koncertów i eventów ${prep} ${capitalize(cityCases.locative)} i okolicach. Dysponujemy własnym parkiem kamer 4K, miksery wizji, enkodery sprzętowe oraz mobilne reżyserki produkcyjne. Nasi operatorzy i realizatorzy zapewniają pełną obsługę techniczną transmisji - od przechwytywania obrazu wielokamerowego, przez miksowanie wizji na żywo, po emisję na platformy streamingowe (YouTube, Vimeo, Teams, Zoom) oraz wyświetlanie na telebimach i ścianach LED.`;

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
