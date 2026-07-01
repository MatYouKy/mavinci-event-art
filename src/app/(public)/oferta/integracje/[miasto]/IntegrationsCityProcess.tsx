import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

const defaultSteps = [
  { number: '01', title: 'Konsultacja i brief', description: 'Poznajemy Twoj zespol, cele integracji, preferencje i oczekiwania. Dobieramy format.' },
  { number: '02', title: 'Scenariusz integracyjny', description: 'Tworzymy autorski scenariusz dopasowany do wielkosci grupy, lokalizacji i celow.' },
  { number: '03', title: 'Przygotowanie i logistyka', description: 'Zabezpieczamy sprzet, rekwizyty, materialy. Koordynujemy z lokalizacja i dostawcami.' },
  { number: '04', title: 'Realizacja z animatorami', description: 'Profesjonalni animatorzy firmowi prowadza event. Zapewniamy koordynacje i bezpieczenstwo.' },
  { number: '05', title: 'Podsumowanie i efekty', description: 'Dokumentacja foto/video, aftermovie, raport z integracji. Zespol zmotywowany i zintegrowany.' },
];

export default function IntegrationsCityProcess({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';

  const steps =
    content?.process_json && Array.isArray(content.process_json) && content.process_json.length > 0
      ? content.process_json
      : defaultSteps;

  return (
    <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
      <div className="mx-auto max-w-4xl">
        <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          Jak organizujemy integracje {prep} {capitalize(cityCases.locative)}
        </h2>

        <div className="relative space-y-8">
          <div className="absolute bottom-0 left-6 top-0 hidden w-px bg-gradient-to-b from-[#d3bb73]/0 via-[#d3bb73]/30 to-[#d3bb73]/0 md:block" />

          {steps.map((step: any, idx: number) => (
            <div key={idx} className="relative flex gap-6">
              <div className="relative z-10 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border-2 border-[#d3bb73] bg-[#0f1119] text-sm font-medium text-[#d3bb73]">
                {step.number}
              </div>
              <div className="flex-1 rounded-xl border border-[#d3bb73]/10 bg-[#0f1119] p-6 transition-colors hover:border-[#d3bb73]/30">
                <h3 className="mb-2 text-lg font-medium text-[#e5e4e2]">{step.title}</h3>
                <p className="text-sm leading-relaxed text-[#e5e4e2]/70">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
