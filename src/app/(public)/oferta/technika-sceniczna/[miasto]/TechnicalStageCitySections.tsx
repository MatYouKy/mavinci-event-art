import 'server-only';
import Link from 'next/link';
import { ArrowUpRight, Check, Monitor, Sun, LayoutGrid } from 'lucide-react';
import type { TechnicalStageCityData } from '@/lib/SEO/technicalStageData.server';
import { stageProcess } from '@/lib/SEO/technicalStageContent';
import { SITE } from '@/lib/SEO/site';
import TechnicalStageCardImage from './TechnicalStageCardImage';

const section = 'scroll-mt-24 px-5 py-14 sm:px-6 md:py-20';
const heading = 'text-2xl font-light uppercase leading-tight sm:text-3xl lg:text-4xl';
const link = 'inline-flex min-h-11 items-center gap-2 text-[#d3bb73] underline underline-offset-4';
const paragraphs = (text: string) => text.split('\n').filter(Boolean).map((part, i) => <p key={i}>{part}</p>);

export default function TechnicalStageCitySections({ data }: { data: TechnicalStageCityData }) {
  const { city, location, displayIntro, content, features, portfolio, gallery, faq } = data;
  const mail = `mailto:${SITE.email}?subject=${encodeURIComponent(`Technika sceniczna i eventowa — ${city.name}`)}&body=${encodeURIComponent(`Dzień dobry,\nProszę o ofertę techniki na wydarzenie.\nMiasto: ${city.name}\nData i godziny:\nObiekt / adres:\nLiczba uczestników:\nProgram / wykonawcy:\nPotrzebny zakres (dźwięk, światło, LED, totemy, telewizory, scena, streaming):\nWarunki montażu i prób:\nTelefon do kontaktu:\n`)}`;
  return <>
    <section className={section}>
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1.3fr_1fr] lg:gap-14">
        <div><h2 className={heading}>{displayIntro.heading}</h2><div className="mt-6 space-y-4 leading-8 text-white/75">{paragraphs(displayIntro.text)}</div></div>
        <aside className="rounded-2xl bg-[#301322] p-6 sm:p-8">
          <p className="text-sm text-[#d3bb73]">Jeden plan dla całego wydarzenia</p>
          <h3 className="mt-3 text-xl uppercase leading-snug">Sprzęt i ludzie, którzy go realizują</h3>
          <ul className="mt-6 space-y-4 text-sm leading-7 text-white/80">
            {['Dźwięk: system Meyer Sound LINA i realizacja audio.', 'Światło: oprawa sceny, wykonawców i przestrzeni wydarzenia.', 'Obraz: LED indoor i outdoor, totemy, telewizory oraz streaming.', 'Produkcja: zakres montażu, prób i obsługi uzgodniony w ofercie.'].map(item => <li key={item} className="flex gap-3"><Check size={18} className="mt-1 shrink-0 text-[#d3bb73]" aria-hidden="true" /><span>{item}</span></li>)}
          </ul>
          <a href="#wycena-techniki" className={`${link} mt-5 text-sm`}>Opowiedz nam o wydarzeniu <ArrowUpRight size={16} aria-hidden="true" /></a>
        </aside>
      </div>
    </section>

    <section id="multimedia" className={`${section} bg-white/[0.025]`}>
      <div className="mx-auto max-w-7xl">
        <p className="mb-3 text-sm text-[#d3bb73]">Technika eventowa do sali i pleneru</p>
        <h2 className={heading}>Ekrany LED, totemy i telewizory {location}</h2>
        <p className="mt-5 max-w-3xl leading-7 text-white/70">Scena to tylko część wydarzenia. Obraz może wspierać prezentację marki, wystąpienie, strefę targową lub komunikację z gośćmi. Dobierzemy nośniki do treści, miejsca i odległości odbiorców.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            { icon: Monitor, title: 'Ekrany LED wewnętrzne', text: 'Do gal, premier, eventów firmowych i prezentacji w salach. Ustalamy proporcje obrazu, rozmiar ekranu, ustawienie względem widowni oraz materiały i źródła sygnału.' },
            { icon: Sun, title: 'Ekrany LED zewnętrzne', text: 'Do wydarzeń plenerowych. Dobór ekranu i sposobu montażu uwzględnia miejsce, warunki pracy, widoczność obrazu, zasilanie i uzgodniony plan produkcji.' },
            { icon: LayoutGrid, title: 'Totemy i telewizory', text: 'Do prezentacji treści i komunikacji w wybranych strefach eventu. Uzgadniamy orientację ekranu, ustawienie, format materiałów, doprowadzenie sygnału i czas działania.' },
          ].map(({ icon: Icon, title, text }) => <article key={title} className="rounded-2xl bg-white/[0.04] p-6 sm:p-7">
            <Icon size={28} className="text-[#d3bb73]" aria-hidden="true" /><h3 className="mt-5 text-lg uppercase">{title}</h3><p className="mt-4 text-sm leading-7 text-white/70">{text}</p>
          </article>)}
        </div>
        <p className="mt-5 text-sm leading-7 text-white/60">Konfigurację, dostępność, montaż oraz obsługę każdego rozwiązania potwierdzamy w ofercie.</p>
      </div>
    </section>

    {features.length > 0 && <section id="zakres-techniki" className={section}>
      <div className="mx-auto max-w-7xl">
        <h2 className={heading}>Nagłośnienie, oświetlenie i obsługa sceny {location}</h2>
        <p className="mt-5 max-w-3xl leading-7 text-white/70">Poznaj nasze zaplecze i dostępne zakresy realizacji. Dobieramy zestaw do wydarzenia; wyposażenie i dodatkowe elementy programu wyszczególniamy w wycenie.</p>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(feature => <article key={feature.id} className="group flex min-w-0 flex-col overflow-hidden rounded-2xl bg-white/[0.04]">
            {feature.image_url && <div className="overflow-hidden"><TechnicalStageCardImage src={feature.image_url} alt={feature.title} /></div>}
            <div className="flex flex-1 flex-col p-6"><h3 className="text-lg uppercase leading-snug">{feature.title}</h3><p className="mt-4 text-sm leading-7 text-white/70">{feature.description}</p>
              {feature.href && <Link href={feature.href} className={`${link} mt-auto pt-5 text-sm`}>Poznaj szczegóły <ArrowUpRight size={16} aria-hidden="true" /><span className="sr-only">: {feature.title}</span></Link>}
            </div>
          </article>)}
        </div>
      </div>
    </section>}

    <section id="plan-realizacji" className={`${section} bg-[#25111d]`}>
      <div className="mx-auto max-w-7xl">
        <h2 className={heading}>{content.planning_heading}</h2>
        <div className="mt-7 grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:gap-14">
          <div className="space-y-4 leading-8 text-white/75">{paragraphs(content.planning_text)}</div>
          <div className="rounded-2xl bg-white/[0.04] p-6 sm:p-8"><h3 className="text-lg uppercase">Ustalmy przed montażem</h3><ul className="mt-5 space-y-4 text-sm leading-7 text-white/75">{content.planning_checks.map((item, i) => <li key={i} className="flex gap-3"><Check size={18} className="mt-1 shrink-0 text-[#d3bb73]" aria-hidden="true" /><span>{item}</span></li>)}</ul></div>
        </div>
        {city.locality === 'olsztyn' && <a className={`${link} mt-5 text-sm`} href={SITE.office.mapsUrl} target="_blank" rel="noopener noreferrer">Dokładny dojazd do biura i magazynu przy Towarowej 20B</a>}
      </div>
    </section>

    <section className={section}>
      <div className="mx-auto max-w-7xl">
        <h2 className={heading}>Technika dopasowana do programu</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {[
            { title: 'Gala, bankiet i premiera', text: 'Czytelny głos prowadzącego, światło podczas wręczania nagród, materiały na ekranie i oprawa części artystycznej. Przygotowujemy zmiany obrazu i światła zgodnie ze scenariuszem.' },
            { title: 'Koncert, DJ i plener', text: 'Zestaw nagłośnienia i odsłuchu, mikrofony, oświetlenie sceniczne oraz obsługa uzgodniona z wykonawcami. Rider, plan sceny i warunki terenu pomagają określić rzeczywiste potrzeby.' },
            { title: 'Targi, prezentacja i event marki', text: 'Ekrany LED, totemy i telewizory do prezentacji produktów oraz treści w strefach wydarzenia. Uzgadniamy źródła obrazu, harmonogram odtwarzania i zakres realizacji.' },
          ].map(item => <article key={item.title} className="rounded-2xl bg-white/[0.04] p-6"><h3 className="text-lg uppercase">{item.title}</h3><p className="mt-4 text-sm leading-7 text-white/70">{item.text}</p></article>)}
        </div>
        <div className="mt-7 flex flex-wrap gap-x-7 gap-y-2 text-sm">
          <Link className={link} href={`/oferta/konferencje/${city.locality}`}>Obsługa techniczna konferencji {location}</Link>
          <Link className={link} href="/oferta/streaming">Streaming i realizacja obrazu</Link>
          <Link className={link} href="/dla-agencji-i-hoteli">Współpraca z agencjami i hotelami</Link>
        </div>
      </div>
    </section>

    {portfolio.length > 0 && <section id="realizacje-techniczne" className={`${section} bg-white/[0.025]`}>
      <div className="mx-auto max-w-7xl">
        <p className="mb-3 text-sm text-[#d3bb73]">Zobacz, jak pracujemy</p><h2 className={heading}>Technika w realizacjach MAVINCI</h2>
        <p className="mt-5 max-w-3xl leading-7 text-white/70">Przykłady z naszego portfolio pokazują oprawę różnych wydarzeń. Zobacz wykorzystanie dźwięku, światła i multimediów; podobne rozwiązania możemy dopasować do Twojego programu i obiektu.</p>
        <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {portfolio.map(project => <article key={project.id} className="group flex min-w-0 flex-col overflow-hidden rounded-2xl bg-white/[0.04]">
            {project.image && <Link href={project.href} tabIndex={-1} aria-hidden="true" className="overflow-hidden"><picture>
              {project.image_metadata?.mobile?.src && <source media="(max-width: 767px)" srcSet={project.image_metadata.mobile.src} />}
              <img src={project.image_metadata?.desktop?.src || project.image} alt="" width={960} height={600} loading="lazy" decoding="async" className="aspect-[16/10] w-full object-cover motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-[1.02]" />
            </picture></Link>}
            <div className="flex flex-1 flex-col p-6">
              {project.location && project.location !== 'Polska' && <p className="mb-3 text-xs text-[#d3bb73]">Miejsce realizacji: {project.location}</p>}
              <h3 className="text-lg uppercase leading-snug"><Link href={project.href} className="hover:text-[#d3bb73]">{project.title}</Link></h3>
              <p className="mt-4 whitespace-pre-line text-sm leading-7 text-white/70">{project.description}</p>
              <Link href={project.href} className={`${link} mt-auto pt-5 text-sm`}>Zobacz realizację <ArrowUpRight size={16} aria-hidden="true" /></Link>
            </div>
          </article>)}
        </div>
      </div>
    </section>}

    {gallery.length > 0 && <section className={section}>
      <div className="mx-auto max-w-7xl"><h2 className={heading}>Światło, obraz i zaplecze w obiektywie</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{gallery.map(item => <figure key={item.id} className="overflow-hidden rounded-2xl bg-white/[0.04]">
          <a href={item.image_url} target="_blank" rel="noopener noreferrer" aria-label={`Powiększ zdjęcie: ${item.title || 'Technika eventowa MAVINCI'}`}><TechnicalStageCardImage src={item.image_url} alt={item.title?.replace(/\.(jpe?g|png|webp)$/i, '') || 'Technika eventowa MAVINCI'} /></a>
          {item.title && <figcaption className="px-5 py-4 text-sm leading-6 text-white/70">{item.title.replace(/\.(jpe?g|png|webp)$/i, '')}</figcaption>}
        </figure>)}</div>
      </div>
    </section>}

    <section className={`${section} bg-white/[0.025]`}>
      <div className="mx-auto max-w-7xl"><h2 className={heading}>Od briefu do ostatniego punktu programu</h2>
        <ol className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{stageProcess.map((item, i) => <li key={item.title} className="rounded-2xl bg-white/[0.04] p-6">
          <span className="text-3xl text-[#d3bb73]/65" aria-hidden="true">0{i + 1}</span><h3 className="mt-4 text-lg uppercase">{item.title}</h3><p className="mt-4 text-sm leading-7 text-white/70">{item.description}</p>
        </li>)}</ol>
      </div>
    </section>

    {faq.length > 0 && <section id="pytania" className={section}>
      <div className="mx-auto max-w-4xl"><h2 className={heading}>Pytania o technikę sceniczną i eventową {location}</h2>
        <div className="mt-8 space-y-3">{faq.map((item, i) => <details key={item.question} open={i === 0} className="group rounded-xl bg-white/[0.04] px-5 sm:px-6">
          <summary className="cursor-pointer py-5 text-base leading-7 text-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d3bb73]/40">{item.question}</summary>
          <p className="pb-6 text-sm leading-7 text-white/70">{item.answer}</p>
        </details>)}</div>
      </div>
    </section>}

    <section id="wycena-techniki" className={section}>
      <div className="mx-auto grid max-w-7xl gap-8 rounded-3xl bg-[#341321] p-6 sm:p-9 lg:grid-cols-[1.1fr_1fr] lg:p-12">
        <div><p className="mb-3 text-sm text-[#d3bb73]">Porozmawiajmy o Twojej produkcji</p><h2 className={heading}>Wycena techniki {location}</h2>
          <p className="mt-5 leading-8 text-white/75">Wyślij termin, adres, liczbę uczestników i program. Dołącz rider lub plan miejsca, jeśli już je masz. Możemy zacząć od doboru zakresu na podstawie krótkiego opisu wydarzenia.</p>
          <div className="mt-6 flex flex-wrap gap-3"><a href={mail} className="inline-flex min-h-12 items-center rounded-full bg-[#d3bb73] px-6 py-3 text-sm font-medium text-[#190f1b]">Wyślij zapytanie o technikę</a><a href={SITE.phoneHref} className="inline-flex min-h-12 items-center rounded-full bg-white/10 px-6 py-3 text-sm">{SITE.telephone}</a></div>
          <Link href="/#kontakt" className={`${link} mt-4 text-sm`}>Przejdź do formularza kontaktowego</Link>
        </div>
        <div><h3 className="text-lg uppercase">Co wpływa na koszt?</h3><ul className="mt-5 list-disc space-y-3 pl-5 text-sm leading-7 text-white/75">
          <li>Konfiguracja nagłośnienia, światła i wymagania wykonawców.</li><li>Liczba, rodzaj i rozmiary ekranów LED, totemów oraz telewizorów.</li><li>Scena, podesty, warunki montażu i wyposażenie dostępne w obiekcie.</li><li>Czas pracy, transport, próby i liczba realizatorów.</li><li>Kamery, streaming, nagranie i przygotowanie multimediów.</li>
        </ul><p className="mt-6 text-sm leading-7 text-white/60">Biuro i magazyn: {SITE.office.street}, {SITE.office.postalCode} {SITE.office.city}. Obsługujemy wydarzenia w całej Polsce.</p></div>
      </div>
    </section>
  </>;
}
