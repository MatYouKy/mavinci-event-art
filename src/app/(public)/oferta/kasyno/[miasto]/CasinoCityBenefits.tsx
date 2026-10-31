import { casinoBenefits } from '@/lib/SEO/casinoCityContent';
import { CheckCircle } from 'lucide-react';
import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

export default function CasinoCityBenefits({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';
  const heading =
    content?.benefits_heading ||
    `Dlaczego warto wybrać nas ${prep} ${capitalize(cityCases.locative)}`;

  const benefits =
    content?.benefits_json && Array.isArray(content.benefits_json) && content.benefits_json.length > 0
      ? content.benefits_json
      : casinoBenefits;

  return (
    <section className="bg-[#291320]/30 px-5 py-14 sm:px-6 md:py-20">
      <div className="mx-auto max-w-7xl">
        <h2 className="mb-12 text-center text-3xl font-light uppercase text-[#e5e4e2] md:text-4xl">
          {heading}
        </h2>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {benefits.map((benefit: any, idx: number) => (
            <div key={idx} className="flex gap-4">
              <div className="flex-shrink-0">
                <CheckCircle className="h-6 w-6 text-[#d3bb73]" />
              </div>
              <div>
                <h3 className="mb-1 font-medium uppercase text-[#e5e4e2]">{benefit.title}</h3>
                {benefit.description && <p className="text-sm leading-relaxed text-[#e5e4e2]/60">{benefit.description}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
