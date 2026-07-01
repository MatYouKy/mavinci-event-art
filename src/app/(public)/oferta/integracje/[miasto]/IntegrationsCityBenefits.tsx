import { Target, Heart, TrendingUp, Shield, Lightbulb, Award, CheckCircle } from 'lucide-react';
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
  'Skuteczne budowanie zespolu i zaufania',
  'Wzrost motywacji i zaangazowania pracownikow',
  'Poprawa komunikacji w zespole',
  'Kreatywne scenariusze dopasowane do firmy',
  'Profesjonalni animatorzy i koordynatorzy',
  'Elastyczne formaty: outdoor, indoor, hybrydowe',
  'Bezpieczenstwo i ubezpieczenie uczestnikow',
  'Dokumentacja foto i video z eventu',
  'Kompleksowa obsluga od A do Z',
];

export default function IntegrationsCityBenefits({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';

  const benefits =
    content?.benefits_json && Array.isArray(content.benefits_json) && content.benefits_json.length > 0
      ? content.benefits_json
      : defaultBenefits;

  return (
    <section className="border-b border-[#d3bb73]/10 px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          Korzyści z integracji {prep} {capitalize(cityCases.locative)}
        </h2>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {benefits.map((benefit: string, idx: number) => (
            <div
              key={idx}
              className="flex items-start gap-3 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]/50 p-4 transition-colors hover:border-[#d3bb73]/30"
            >
              <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#d3bb73]" />
              <span className="text-sm leading-relaxed text-[#e5e4e2]/80">{benefit}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
