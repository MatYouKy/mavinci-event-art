import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

const defaultFAQ = [
  {
    question: 'Ile kamer można użyć jednocześnie?',
    answer:
      'Standardowo realizujemy od 2 do 8 kamer. W przypadku dużych produkcji możemy obsłużyć nawet 12+ źródeł obrazu jednocześnie - kamery stacjonarne, ruchome PTZ, drony i kamery mobilne.',
  },
  {
    question: 'Na jakie platformy możecie streamować?',
    answer:
      'Obsługujemy wszystkie popularne platformy: YouTube Live, Vimeo, Facebook Live, Microsoft Teams, Zoom Webinar, a także dedykowane serwery RTMP/SRT. Możliwy multistreaming na kilka platform jednocześnie.',
  },
  {
    question: 'Czy zapewniacie backup łącza internetowego?',
    answer:
      'Tak, zawsze. Standardowo używamy bonding 4G/5G z 4 kartami SIM różnych operatorów plus dedykowane łącze kablowe z lokalizacji. Monitorujemy bitrate w czasie rzeczywistym.',
  },
  {
    question: 'Jakie ekrany LED oferujecie?',
    answer:
      'Dysponujemy ścianami LED o pixel pitch 1.9mm, 2.6mm, 3.9mm (indoor) oraz 5.9mm (outdoor). Montujemy w dowolnej konfiguracji - od małych monitorów po ściany 12x4m.',
  },
  {
    question: 'Czy otrzymam nagranie po wydarzeniu?',
    answer:
      'Tak. Nagrywamy ISO (każda kamera osobno) oraz miks programowy. Na życzenie montujemy highlight reel, teaser lub pełną relację z koloryzacją i grafiką.',
  },
  {
    question: 'Jak wcześnie trzeba zarezerwować termin?',
    answer:
      'Rekomendujemy rezerwację min. 2-3 tygodnie wcześniej, zwłaszcza w sezonie eventowym (wrzesień-grudzień). W trybie pilnym jesteśmy w stanie zrealizować projekt w 48h.',
  },
  {
    question: 'Czy obsługujecie transmisje z tłumaczeniem symultanicznym?',
    answer:
      'Tak. Możemy podłączyć kabiny tłumaczy, przekierować audio na osobne kanały streamu lub wyświetlić napisy live na ekranach i w transmisji online.',
  },
];

export default function StreamingCityFAQ({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';

  const faq =
    content?.faq_json && Array.isArray(content.faq_json) && content.faq_json.length > 0
      ? content.faq_json
      : defaultFAQ;

  return (
    <section className="border-b border-[#d3bb73]/10 px-6 py-20">
      <div className="mx-auto max-w-4xl">
        <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          Najczesciej zadawane pytania o streaming {prep} {capitalize(cityCases.locative)}
        </h2>

        <div className="space-y-4">
          {faq.map((item: any, idx: number) => (
            <details
              key={idx}
              className="group rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]/50 transition-colors open:border-[#d3bb73]/30"
            >
              <summary className="cursor-pointer list-none px-6 py-5 text-[#e5e4e2] transition-colors hover:text-[#d3bb73]">
                <div className="flex items-center justify-between">
                  <span className="pr-4 font-medium">{item.question}</span>
                  <span className="flex-shrink-0 text-[#d3bb73] transition-transform group-open:rotate-45">
                    +
                  </span>
                </div>
              </summary>
              <div className="border-t border-[#d3bb73]/10 px-6 py-4">
                <p className="leading-relaxed text-[#e5e4e2]/70">{item.answer}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
