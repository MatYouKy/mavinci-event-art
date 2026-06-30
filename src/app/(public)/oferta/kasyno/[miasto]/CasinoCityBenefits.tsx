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
    title: 'Autentyczne stoły kasynowe',
    description:
      'Pełnowymiarowe stoły do ruletki, blackjacka i pokera jak w prawdziwym kasynie. Profesjonalne sukno, żetony i akcesoria najwyższej jakości.',
  },
  {
    title: 'Doświadczeni krupierzy',
    description:
      'Profesjonalni krupierzy z wieloletnim doświadczeniem. Uczą zasad, prowadzą gry i dbają o atmosferę - idealni dla początkujących i zaawansowanych.',
  },
  {
    title: 'Kompletna oprawa imprezy',
    description:
      'Nie tylko stoły - dostarczamy dekoracje, oświetlenie, muzykę i hostessy. Tworzymy klimat ekskluzywnego kasyna na każdym evencie.',
  },
  {
    title: 'Elastyczność formatu',
    description:
      'Od kameralnego wieczoru pokerowego (10 osób) po wielki event kasynowy (500+ gości). Dostosowujemy liczbę stołów i atrakcji do grupy.',
  },
  {
    title: 'Bezpieczna rozrywka',
    description:
      'Kasyno rozrywkowe bez prawdziwych pieniędzy. Uczestnicy grają na żetony, rywalizują o nagrody. Czysta zabawa bez ryzyka finansowego.',
  },
  {
    title: 'Personalizacja i branding',
    description:
      'Żetony z logo firmy, banknoty zabawowe z twarzami szefów, spersonalizowane koło fortuny. Każdy element może być dostosowany do klienta.',
  },
];

export default function CasinoCityBenefits({ cityCases, content }: Props) {
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
