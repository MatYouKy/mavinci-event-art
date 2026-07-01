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
    title: 'Kompleksowa realizacja od A do Z',
    description:
      'Zajmujemy się wszystkim - od koncepcji kreatywnej, przez scenografię i dekoracje, aż po obsługę techniczną i artystyczną wieczoru.',
  },
  {
    title: 'Spójne doświadczenie tematyczne',
    description:
      'Każdy element jest dopasowany do motywu przewodniego - od zaproszeń, przez dress code, dekoracje, muzykę, aż po menu i animacje.',
  },
  {
    title: 'Własny park sprzętowy i rekwizytów',
    description:
      'Dysponujemy magazynem dekoracji, mebli tematycznych, stołów kasynowych i rekwizytów - nie wynajmujemy od pośredników.',
  },
  {
    title: 'Doświadczony zespół kreatywny',
    description:
      'Nasi scenografowie, aktorzy i animatorzy mają wieloletnie doświadczenie w realizacji wieczorów tematycznych dla firm.',
  },
  {
    title: 'Personalizacja do Twojej marki',
    description:
      'Wplatamy elementy brandingowe firmy w scenografię - logotypy, kolory firmowe, indywidualne nagrody i gadżety.',
  },
  {
    title: 'Obsługa techniczna premium',
    description:
      'Profesjonalne nagłośnienie, oświetlenie architektoniczne, efekty specjalne i projekcje - wszystko pod jednym dachem.',
  },
];

export default function ThemedPartyCityBenefits({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';
  const heading =
    content?.benefits_heading ||
    `Dlaczego warto zorganizować wieczór tematyczny ${prep} ${capitalize(cityCases.locative)} z nami`;

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
