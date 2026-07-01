import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

export default function ThemedPartyCityIntro({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';

  const heading =
    content?.intro_heading ||
    `Wieczory tematyczne ${prep} ${capitalize(cityCases.locative)} - niezapomniane eventy firmowe`;

  const text =
    content?.intro_text ||
    `Organizujemy kompleksowe wieczory tematyczne ${prep} ${capitalize(cityCases.locative)} i okolicach. Od pomysłu, przez scenografię i dekoracje, aż po animacje, aktorów i oprawę muzyczną - tworzymy spójne, immersyjne doświadczenia eventowe. Nasze imprezy tematyczne to idealne rozwiązanie na integrację firmową, event korporacyjny, galę jubileuszową czy wieczór dla klientów VIP.\n\nSpecjalizujemy się w tworzeniu klimatycznych scenerii, które przenoszą gości w zupełnie inny świat. Casino Night, Hollywood, PRL, Dziki Zachód, lata 20-te, tropikalna fiesta - każdy motyw realizujemy z dbałością o najdrobniejsze detale. Zapewniamy pełną obsługę techniczną i artystyczną.`;

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
