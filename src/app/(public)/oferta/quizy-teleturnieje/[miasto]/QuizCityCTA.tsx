import { Phone } from 'lucide-react';
import Link from 'next/link';
import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

export default function QuizCityCTA({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';

  const heading =
    content?.cta_heading ||
    `Chcesz zorganizować teleturniej ${prep} ${capitalize(cityCases.locative)}?`;

  const description =
    content?.cta_description ||
    `Skontaktuj się z nami - doradzimy najlepszy format quizu dla Twojego zespołu ${prep} ${capitalize(cityCases.locative)}. Bezpłatna konsultacja i wycena w 24h.`;

  const phone = content?.cta_phone || '+48 123 456 789';

  return (
    <section className="px-6 py-24">
      <div className="mx-auto max-w-4xl rounded-2xl border border-[#d3bb73]/30 bg-gradient-to-br from-[#1c1f33] to-[#0f1119] p-12 text-center">
        <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">{heading}</h2>
        <p className="mx-auto mb-8 max-w-2xl text-lg text-[#e5e4e2]/70">{description}</p>

        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href="/#kontakt"
            className="rounded-lg bg-[#d3bb73] px-8 py-3.5 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            Zapytaj o wycene
          </Link>
          <a
            href={`tel:${phone.replace(/\s/g, '')}`}
            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 px-6 py-3.5 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
          >
            <Phone className="h-4 w-4" />
            {phone}
          </a>
        </div>

        <div className="mt-10 flex flex-wrap justify-center gap-6 text-sm text-[#e5e4e2]/50">
          <span>Bezplatna konsultacja</span>
          <span className="text-[#d3bb73]/30">|</span>
          <span>Wycena w 24h</span>
          <span className="text-[#d3bb73]/30">|</span>
          <span>Autorskie formaty</span>
          <span className="text-[#d3bb73]/30">|</span>
          <span>Prowadzacy z TV</span>
        </div>
      </div>
    </section>
  );
}
