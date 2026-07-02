import { CheckCircle } from 'lucide-react';
import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases?: PolishCityCases | null;
  content?: any;
};

const defaultBenefits = [
  {
    title: 'Własny park sprzętowy',
    description:
      'Nie pośredniczymy - posiadamy własny sprzęt najwyższej klasy. Gwarancja dostępności, serwis techniczny i pełna kontrola jakości.',
  },
  {
    title: 'Certyfikowani technicy',
    description:
      'Zespół z uprawnieniami UDT, certyfikatami producentów (L-Acoustics, MA Lighting, Robe) i wieloletnim doświadczeniem w realizacjach live.',
  },
  {
    title: 'Kompleksowa obsługa',
    description:
      'Od projektu technicznego i rideru, przez logistykę i montaż, po realizację i demontaż. Jeden wykonawca - pełna odpowiedzialność.',
  },
  {
    title: 'Realizacje 50–50 000 osób',
    description:
      'Skalowalne rozwiązania dla eventów kameralnych, konferencji korporacyjnych i wielkich festiwali. Dobieramy sprzęt do potrzeb i budżetu.',
  },
  {
    title: 'Redundancja i bezpieczeństwo',
    description:
      'Backup kluczowych systemów, UPS, zapasowe procesory i konsolety. Pełna dokumentacja techniczna i ubezpieczenie OC.',
  },
  {
    title: 'Wsparcie 24/7',
    description:
      'Kierownik techniczny dostępny przez cały czas trwania eventu. Serwis na miejscu, zapasowy sprzęt w magazynie mobilnym.',
  },
];

export default function TechStageCityBenefits({ cityCases, content }: Props) {
  const hasCity = !!cityCases;

  const heading =
    content?.benefits_heading ||
    (hasCity
      ? `Dlaczego warto wybrać nas ${
          cityCases.locative_preposition || 'w'
        } ${capitalize(cityCases.locative)}`
      : 'Dlaczego warto wybrać nas');

  const benefits =
    Array.isArray(content?.benefits_json) && content.benefits_json.length > 0
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
                <h3 className="mb-1 font-medium text-[#e5e4e2]">
                  {benefit.title}
                </h3>

                <p className="text-sm leading-relaxed text-[#e5e4e2]/60">
                  {benefit.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}