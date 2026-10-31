import { SITE } from '@/lib/SEO/site';
import { Phone } from 'lucide-react';
import Link from 'next/link';
import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

export default function CasinoCityCTA({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';

  const heading =
    content?.cta_heading ||
    `Potrzebujesz kasyna rozrywkowego ${prep} ${capitalize(cityCases.locative)}?`;

  const description =
    content?.cta_description ||
    `Skontaktuj się z nami - przygotujemy indywidualną wycenę kasyna rozrywkowego dopasowaną do Twojego wydarzenia ${prep} ${capitalize(cityCases.locative)}. Zakres, logistykę i koszt dopasujemy do miejsca oraz programu imprezy.`;

  const customPhone = typeof content?.cta_phone === 'string' ? content.cta_phone.trim() : '';
  const phoneDigits = customPhone.replace(/[^+\d]/g, '');
  const phone = /^\+?\d{9,15}$/.test(phoneDigits) && !phoneDigits.endsWith('123456789')
    ? customPhone : SITE.telephone;

  return (
    <section id="wycena-kasyna" className="scroll-mt-24 px-5 py-16 sm:px-6 md:py-24">
      <div className="mx-auto max-w-4xl rounded-2xl border border-white/10 bg-gradient-to-br from-[#1c1f33] to-[#0f1119] p-6 text-center sm:p-12">
        <h2 className="mb-4 text-3xl font-light uppercase text-[#e5e4e2] md:text-4xl">{heading}</h2>
        <p className="mx-auto mb-8 max-w-2xl text-lg text-[#e5e4e2]/70">{description}</p>

        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href="/#kontakt"
            className="w-full rounded-lg sm:w-auto bg-[#d3bb73] px-8 py-3.5 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            Zapytaj o wycenę
          </Link>
          <a
            href={`tel:${phone.replace(/[^+\d]/g, '')}`}
            className="flex w-full items-center justify-center gap-2 rounded-lg sm:w-auto border border-[#d3bb73]/30 px-6 py-3.5 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
          >
            <Phone className="h-4 w-4" />
            {phone}
          </a>
        </div>

        <div className="mt-10 flex flex-wrap justify-center gap-6 text-sm text-[#e5e4e2]/50">
          <span>Konsultacja</span>
          <span className="text-[#d3bb73]/30">|</span>
          <span>Indywidualna wycena</span>
          <span className="text-[#d3bb73]/30">|</span>
          <span>Profesjonalni krupierzy</span>
          <span className="text-[#d3bb73]/30">|</span>
          <span>Własny sprzęt</span>
        </div>
      </div>
    </section>
  );
}
