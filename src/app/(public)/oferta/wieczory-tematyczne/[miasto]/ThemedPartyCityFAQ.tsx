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
    question: 'Ile osób może wziąć udział w wieczorze tematycznym?',
    answer:
      'Realizujemy eventy od kameralnych spotkań dla 20 osób po duże gale na 500+ gości. Dostosowujemy scenografię, liczbę atrakcji i obsługę do wielkości grupy.',
  },
  {
    question: 'Jak wcześnie trzeba zarezerwować termin?',
    answer:
      'Rekomendujemy rezerwację min. 3-4 tygodnie wcześniej, aby mieć czas na produkcję dedykowanych elementów scenografii. W trybie ekspresowym jesteśmy w stanie zrealizować event w 7 dni.',
  },
  {
    question: 'Czy zapewniacie lokalizację na wieczór tematyczny?',
    answer:
      'Działamy w modelu BYOV (Bring Your Own Venue) - przyjeżdżamy do dowolnej lokalizacji: hotel, restauracja, loft, centrum konferencyjne, hala. Możemy też polecić sprawdzone miejsca.',
  },
  {
    question: 'Czy można łączyć kilka motywów na jednym evencie?',
    answer:
      'Tak! Popularne połączenia to np. Casino Night + Great Gatsby, Hollywood + Casino, PRL + Disco. Tworzymy spójne koncepcje łączące elementy różnych epok.',
  },
  {
    question: 'Co obejmuje wycena wieczoru tematycznego?',
    answer:
      'Standardowa wycena zawiera: koncepcję kreatywną, scenografię i dekoracje, transport i montaż, obsługę techniczną (nagłośnienie, oświetlenie), atrakcje i animacje. Catering i lokalizacja są wyceniane osobno.',
  },
  {
    question: 'Czy organizujecie wieczory tematyczne poza miastem?',
    answer:
      'Tak, realizujemy eventy w całej Polsce. Dojeżdżamy do każdej lokalizacji - hotele pod miastem, rezydencje, zamki, pałace. Cena transportu zależy od odległości.',
  },
  {
    question: 'Czy można zamówić tylko część usług (np. same dekoracje)?',
    answer:
      'Oczywiście. Oferujemy zarówno kompleksową realizację, jak i pojedyncze elementy: wynajem stołów kasynowych, dekoracje tematyczne, obsługa DJ, aktorzy. Wyceniamy indywidualnie.',
  },
];

export default function ThemedPartyCityFAQ({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';

  const faq =
    content?.faq_json && Array.isArray(content.faq_json) && content.faq_json.length > 0
      ? content.faq_json
      : defaultFAQ;

  return (
    <section className="border-b border-[#d3bb73]/10 px-6 py-20">
      <div className="mx-auto max-w-4xl">
        <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          Najczesciej zadawane pytania o wieczory tematyczne {prep} {capitalize(cityCases.locative)}
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
