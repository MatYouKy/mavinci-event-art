import 'server-only';
import Link from 'next/link';
import { ArrowUpRight, Music2, Sparkles, MonitorPlay } from 'lucide-react';
import CityMapEmbed from '@/components/CityMapEmbed/CityMapEmbed';
import { SITE } from '@/lib/SEO/site';
import type { ThemedPartyCityData } from '@/lib/SEO/themedPartyData.server';
import { THEMED_PARTY_PATH } from '@/lib/SEO/themedPartyContent';

const section = 'mx-auto max-w-7xl px-5 py-14 sm:px-6 md:py-20';
const heading = 'text-2xl font-light uppercase leading-snug sm:text-3xl';
const text = 'mt-5 max-w-3xl text-base leading-7 text-white/75';
const link = 'inline-flex min-h-11 items-center gap-2 text-sm text-[#d3bb73] underline decoration-[#d3bb73]/30 underline-offset-4 hover:decoration-[#d3bb73]';

export function ThemedPartyIntro({ data }: { data: ThemedPartyCityData }) {
  return <section className={section}>
    <p className="mb-3 text-sm text-[#d3bb73]">Dla firm · działów HR · organizatorów konferencji</p>
    <h2 className={heading}>{data.content.intro_heading}</h2>
    <p className={text}>{data.content.intro_text}</p>
    <div className="mt-9 grid gap-4 md:grid-cols-3">
      {[
        ['Po konferencji', 'Kolacja, krótka część prowadzona i czas na swobodne rozmowy lub taniec. Godziny wejść i prób dopasowujemy do zakończenia części biznesowej.'],
        ['Integracja tematyczna', 'Quiz, teleturniej lub kasyno rozrywkowe mogą ułatwić kontakt między osobami z różnych działów. Dobieramy aktywności do grupy i charakteru firmy.'],
        ['Gala lub jubileusz', 'Scenariusz obejmuje wystąpienia, podziękowania i momenty wręczenia nagród, a później wspólną zabawę. Motyw łączy część oficjalną z wieczorną.'],
      ].map(([title, body], i) => <article key={title} className="rounded-2xl bg-white/[0.045] p-6">
        <span className="text-sm text-[#d3bb73]/70">0{i + 1}</span><h3 className="mt-4 text-lg text-[#d3bb73]">{title}</h3><p className="mt-3 text-sm leading-6 text-white/70">{body}</p>
      </article>)}
    </div>
    <div className="mt-6 flex flex-wrap gap-x-7"><Link href="/oferta/integracje" className={link}>Poznaj inne formaty integracji firmowych <ArrowUpRight size={16} /></Link><Link href={`/oferta/konferencje/${data.city.locality}`} className={link}>Połącz wieczór z obsługą konferencji <ArrowUpRight size={16} /></Link></div>
  </section>;
}

export function ThemedPartyPortfolio({ data }: { data: ThemedPartyCityData }) {
  if (!data.portfolio.length) return null;
  return <section id="realizacje" className={section}>
    <h2 className={heading}>Zobacz, jak realizujemy motywy wydarzeń</h2>
    <p className={text}>Wybrane projekty MAVINCI pokazują połączenie scenografii, muzyki i atrakcji. To przykłady naszego doświadczenia z różnych miejsc; zakres podobnego wieczoru {data.location} ustalamy indywidualnie.</p>
    <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {data.portfolio.map(project => {
        const image = project.image_metadata?.desktop?.src || project.image;
        const mobile = project.image_metadata?.mobile?.src;
        return <article key={project.id} className="group overflow-hidden rounded-2xl bg-white/[0.045]">
          {image && <Link href={project.href} tabIndex={-1} aria-hidden="true"><picture>
            {mobile && mobile !== image && <source media="(max-width: 767px)" srcSet={mobile} />}
            <img src={image} width={800} height={500} alt={project.alt || project.title} loading="lazy" decoding="async" className="aspect-[16/10] w-full object-cover motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-[1.02]" />
          </picture></Link>}
          <div className="p-6">
            {project.location && project.location !== 'Polska' && <p className="mb-3 text-sm text-white/55">Miejsce realizacji: {project.location}</p>}
            <h3 className="text-lg text-[#d3bb73]"><Link href={project.href} className="hover:underline">{project.title}</Link></h3>
            <p className="mt-3 whitespace-pre-line text-sm leading-6 text-white/75">{project.description}</p>
            <Link href={project.href} className={`${link} mt-3`}>Zobacz zdjęcia i zakres realizacji <ArrowUpRight size={16} /></Link>
          </div>
        </article>;
      })}
    </div>
  </section>;
}

export function ThemedPartyTechnical({ data }: { data: ThemedPartyCityData }) {
  return <section className="bg-[#291320]/60"><div className={section}>
    <h2 className={heading}>Muzyka, prowadzenie i własna technika</h2>
    <p className={text}>Motyw powinien działać podczas całego wieczoru — od powitania przez część oficjalną po parkiet. Dobieramy wyposażenie do sali i programu; konkretny zestaw zapisujemy w ofercie.</p>
    <div className="mt-9 grid gap-7 md:grid-cols-3">
      {[
        { Icon: Music2, title: 'Muzyka i kontakt z gośćmi', body: 'DJ, prowadzący i uzgodnione występy instrumentalistów budują rytm spotkania. Ustalamy repertuar, zapowiedzi i przejścia między atrakcjami.', href: '/oferta/dj-eventowy', label: 'Oprawa muzyczna wydarzeń' },
        { Icon: Sparkles, title: 'Światło i dźwięk', body: 'Dysponujemy nagłośnieniem Meyer Sound LINA i oświetleniem. Dobieramy je tak, aby przemówienia były zrozumiałe, a światło wspierało dekoracje i zabawę.', href: `/oferta/technika-sceniczna/${data.city.locality}`, label: 'Technika sceniczna i eventowa' },
        { Icon: MonitorPlay, title: 'Obraz i wspólny program', body: 'Ekrany LED, telewizory i totemy mogą pokazywać materiały firmy, oprawę gali lub wyniki gry. Quizy i teleturnieje dobieramy do uczestników i przebiegu wieczoru.', href: '/oferta/quizy-teleturnieje', label: 'Quizy i teleturnieje dla firm' },
      ].map(({ Icon, title, body, href, label }) => <article key={title}><Icon size={28} className="text-[#d3bb73]" aria-hidden="true" /><h3 className="mt-5 text-lg text-[#d3bb73]">{title}</h3><p className="mt-3 text-sm leading-6 text-white/75">{body}</p><Link href={href} className={`${link} mt-3`}>{label}</Link></article>)}
    </div>
  </div></section>;
}

export function ThemedPartyPlanning({ data }: { data: ThemedPartyCityData }) {
  const local = data.city.locality === 'olsztyn';
  return <section className="py-6">
    <div className={section}>
      <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        <div><h2 className={heading}>{data.content.planning_heading}</h2><p className={text}>{data.content.planning_text}</p></div>
        <div className="rounded-2xl bg-white/[0.045] p-6"><h3 className="text-lg text-[#d3bb73]">Co ustalamy z organizatorem i obiektem</h3><ul className="mt-5 space-y-4 text-sm leading-6 text-white/75">{data.content.planning_checks.map((check, i) => <li key={i} className="flex gap-3"><span aria-hidden="true" className="text-[#d3bb73]">✓</span>{check}</li>)}</ul></div>
      </div>
      <h3 className="mt-10 text-lg text-[#d3bb73]">Od pomysłu do realizacji</h3>
      <ol className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {['Brief: cel, grupa, termin i budżet.', 'Koncepcja: motyw, program i zakres oferty.', 'Przygotowanie: harmonogram, technika i ustalenia z obiektem.', 'Realizacja: montaż, próby i koordynacja przebiegu wieczoru.'].map((step, i) => <li key={step} className="text-sm leading-6 text-white/75"><span className="mb-2 block text-[#d3bb73]">0{i + 1}</span>{step}</li>)}
      </ol>
      <p className="mt-10 text-sm leading-6 text-white/65">{local ? 'Mapa wskazuje dokładny budynek naszego biura i magazynu przy ul. Towarowej 20B. Miejsce imprezy wybieramy wspólnie z organizatorem.' : `Mapa pokazuje obszar obsługi: ${data.city.name}. Biuro i magazyn MAVINCI znajdują się w Olsztynie przy ul. Towarowej 20B.`}</p>
      {local && <a href={SITE.office.mapsUrl} className={link} target="_blank" rel="noopener noreferrer">Otwórz dokładną lokalizację biura w Google Maps</a>}
    </div>
    <CityMapEmbed query={local ? `${SITE.office.latitude},${SITE.office.longitude}` : `${data.city.name}, Polska`} title={local ? 'MAVINCI — biuro i magazyn, Towarowa 20B w Olsztynie' : `Obszar obsługi wieczorów tematycznych: ${data.city.name}`} height={320} zoom={local ? 16 : 11} />
  </section>;
}

export function ThemedPartyQuestions({ data }: { data: ThemedPartyCityData }) {
  if (!data.faq.length) return null;
  return <section id="pytania" className={section}><h2 className={heading}>Imprezy tematyczne dla firm — pytania przed rezerwacją</h2>
    <div className="mt-8 max-w-4xl space-y-3">{data.faq.map((item, i) => <details key={i} className="rounded-xl bg-white/[0.045] p-5"><summary className="cursor-pointer text-base leading-6 text-[#d3bb73]">{item.question}</summary><p className="mt-4 whitespace-pre-line text-sm leading-7 text-white/75">{item.answer}</p></details>)}</div>
  </section>;
}

export function ThemedPartyRelated({ data }: { data: ThemedPartyCityData }) {
  return <nav aria-label="Powiązane oferty i obszar obsługi" className={section}>
    <h2 className="text-xl font-light uppercase">Dobierz pozostałe elementy wydarzenia</h2>
    <div className="mt-4 flex flex-wrap gap-x-7 gap-y-2">
      <Link href="/oferta/integracje" className={link}>Integracje firmowe</Link>
      <Link href={`/oferta/kasyno/${data.city.locality}`} className={link}>Kasyno rozrywkowe — {data.city.name}</Link>
      <Link href="/dla-agencji-i-hoteli" className={link}>Współpraca z agencjami i hotelami</Link>
      <Link href={THEMED_PARTY_PATH} className={link}>Wszystkie motywy wieczorów</Link>
    </div>
    {data.nearbyCities.length > 0 && <><p className="mt-8 text-sm text-white/65">Obsługujemy również wydarzenia w regionie. Sprawdź ofertę dla wybranej lokalizacji:</p><div className="mt-2 flex flex-wrap gap-x-6">{data.nearbyCities.map(city => <Link key={city.id} className={link} href={`${THEMED_PARTY_PATH}/${city.locality}`}>{city.name}</Link>)}</div></>}
    <Link href={`${THEMED_PARTY_PATH}/lokalizacje`} className={`${link} mt-4`}>Wszystkie lokalizacje obsługi</Link>
  </nav>;
}
