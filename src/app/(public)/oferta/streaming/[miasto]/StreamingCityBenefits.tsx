import { CheckCircle } from 'lucide-react';
import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

const defaultBenefits = [
  {
    title: 'Realizacja wielokamerowa Full HD / 4K',
    description:
      'Od 2 do 8 kamer z profesjonalną reżyserką wizji. Obraz kinowej jakości nawet przy trudnych warunkach oświetleniowych.',
  },
  {
    title: 'Transmisja na dowolną platformę',
    description:
      'YouTube, Vimeo, Facebook, Teams, Zoom, własne serwery RTMP. Multistreaming na kilka platform jednocześnie.',
  },
  {
    title: 'Ściany LED i telebimy',
    description:
      'Wynajem i montaż ekranów LED dowolnej wielkości. Idealne do konferencji, koncertów, targów i eventów outdoor.',
  },
  {
    title: 'Oprawa graficzna w czasie rzeczywistym',
    description:
      'Lower thirds, logotypy, animowane przejścia, plansze, countdown. Wszystko generowane live bez opóźnień.',
  },
  {
    title: 'Stabilność i redundancja',
    description:
      'Backup każdego kluczowego elementu: łącze, enkoder, zasilanie. Monitorujemy bitrate i jakość w czasie rzeczywistym.',
  },
  {
    title: 'Pełna postprodukcja',
    description:
      'Nagranie ISO każdej kamery, montaż highlight reel, koloryzacja, eksport w formatach do social media.',
  },
];

export default function StreamingCityBenefits({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';
  const heading =
    content?.benefits_heading ||
    `Dlaczego warto wybrać nas ${prep} ${capitalize(cityCases.locative)}`;

  const benefits =
    content?.benefits_json && Array.isArray(content.benefits_json) && content.benefits_json.length > 0
      ? content.benefits_json
      : defaultBenefits;

  return (
    <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          {heading}
        </h2>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {benefits.map((benefit: any, idx: number) => (
            <div key={idx} className="flex gap-4">
              <div className="flex-shrink-0">
                <CheckCircle className="h-6 w-6 text-[#d3bb73]" />
              </div>
              <div>
                <h3 className="mb-1 font-medium text-[#e5e4e2]">{benefit.title}</h3>
                <p className="text-sm leading-relaxed text-[#e5e4e2]/60">{benefit.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
