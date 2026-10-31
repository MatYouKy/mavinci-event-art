import 'server-only';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, Check } from 'lucide-react';
import PageLayout from '@/components/Layout/PageLayout';
import { ServerBreadcrumb } from '@/components/Layout/ServerBreadcrumb';
import { SITE, ORGANIZATION_ID, WEBSITE_ID } from '@/lib/SEO/site';
import { agencyProcess } from '@/lib/SEO/eventAgencyContent';
import type { AgencyData } from '@/lib/SEO/eventAgencyData.server';
import AgencyEditor from './AgencyEditor';
import styles from './agency.module.css';

export function agencyMetadata(data: AgencyData): Metadata {
  return { title: { absolute: data.metaTitle }, description: data.description,
    alternates: { canonical: data.canonicalUrl },
    openGraph: { type: 'website', locale: 'pl_PL', siteName: SITE.name, url: data.canonicalUrl,
      title: data.metaTitle, description: data.description, images: [{ url: data.ogImage, alt: data.imageAlt }] },
    twitter: { card: 'summary_large_image', title: data.metaTitle, description: data.description, images: [data.ogImage] },
  };
}
function AgencyHeading({ heading, city }: { heading: string; city?: string }) {
  if (!city) return <>{heading}<span className={styles.gold}>.</span></>;
  const index = heading.toLocaleLowerCase('pl-PL').indexOf(city.toLocaleLowerCase('pl-PL'));
  return index < 0 ? <>{heading}</> : <>{heading.slice(0, index)}<span className={styles.gold}>{heading.slice(index, index + city.length)}</span>{heading.slice(index + city.length)}</>;
}
function ExpertiseImage({ type }: { type: 'eventy' | 'technika' }) {
  return <img src={`/images/expertise/${type}-768.webp`} srcSet={[480, 768, 1280].map(width => `/images/expertise/${type}-${width}.webp ${width}w`).join(', ')}
    sizes="(min-width: 1024px) 560px, (min-width: 768px) 48vw, calc(100vw - 40px)" width={1280} height={854}
    loading="lazy" decoding="async" alt={type === 'technika' ? 'Realizator MAVINCI przy stanowisku multimediów podczas konferencji PSRWN' : 'Latino Night Castorama — oprawa wydarzenia MAVINCI'} />;
}

export default function AgencyPage({ data, canEdit }: { data: AgencyData; canEdit: boolean }) {
  const { content, city, cities, portfolio, canonicalUrl, pageSlug } = data;
  const labels = { 'agencja-eventowa': 'Agencja eventowa', ...(city ? { [city.slug]: city.name } : {}) };
  const schema = { '@context': 'https://schema.org', '@graph': [
    { '@type': city ? 'WebPage' : 'AboutPage', '@id': `${canonicalUrl}#webpage`, url: canonicalUrl,
      name: data.metaTitle, description: data.description, inLanguage: 'pl-PL', isPartOf: { '@id': WEBSITE_ID },
      about: { '@id': ORGANIZATION_ID }, mainEntity: { '@id': city ? `${canonicalUrl}#organizacja-eventow` : ORGANIZATION_ID },
      relatedLink: portfolio.map(project => `${SITE.url}${project.href}`) },
    ...(city ? [{ '@type': 'Service', '@id': `${canonicalUrl}#organizacja-eventow`, url: canonicalUrl,
      name: `Organizacja eventów firmowych ${city.location} — MAVINCI`, description: content.lead,
      serviceType: 'Organizacja eventów firmowych, integracji, konferencji i gal',
      provider: { '@id': ORGANIZATION_ID }, areaServed: { '@type': 'City', name: city.name } }] : []),
    { '@type': 'FAQPage', '@id': `${canonicalUrl}#pytania`, isPartOf: { '@id': `${canonicalUrl}#webpage` },
      mainEntity: content.faq.map(item => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })) },
    ...(portfolio.length ? [{ '@type': 'ItemList', '@id': `${canonicalUrl}#portfolio`, name: 'Realizacje MAVINCI',
      itemListElement: portfolio.map((project, i) => ({ '@type': 'ListItem', position: i + 1, name: project.title, url: `${SITE.url}${project.href}` })) }] : []),
  ] };
  const mail = `mailto:${SITE.email}?subject=${encodeURIComponent(`Organizacja wydarzenia${city ? ` — ${city.name}` : ''}`)}&body=${encodeURIComponent(`Dzień dobry,\nChcemy przygotować wydarzenie firmowe.\nCel wydarzenia:\nMiasto: ${city?.name || ''}\nTermin:\nLiczba gości:\nObiekt (jeśli wybrany):\nWstępny budżet:\nOczekiwany zakres agencji:\nTelefon do kontaktu:\n`)}`;
  return <PageLayout pageSlug={pageSlug} customSchema={schema} breadcrumbLabels={labels}>
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.inner}>
          <ServerBreadcrumb pageSlug={pageSlug} labels={labels} />
          <div className={styles.heroGrid}>
            <div><p className={styles.eyebrow}>MAVINCI Event & ART · pomysł, ludzie, realizacja</p>
              <h1 className={styles.title}><AgencyHeading heading={content.heading} city={city?.name} /></h1>
              <p className={styles.lead}>{content.lead}</p>
              <div className={styles.actions}><a href="#zaplanuj-event" className={styles.primary}>Zaplanuj z nami wydarzenie <ArrowUpRight size={19} aria-hidden="true" /></a><a href="#realizacje-agencji" className={styles.textLink}>Zobacz nasze realizacje</a></div>
            </div>
            <figure className={styles.visual}>
              <picture>{data.localHero ? data.mobileImage && <source media="(max-width: 767px)" srcSet={data.mobileImage} /> : <source srcSet="/images/expertise/eventy-480.webp 480w, /images/expertise/eventy-768.webp 768w, /images/expertise/eventy-1280.webp 1280w" sizes="(min-width: 1280px) 600px, (min-width: 768px) 48vw, calc(100vw - 40px)" />}
                <img src={data.image} alt={data.imageAlt} width={1280} height={853} fetchPriority="high" loading="eager" decoding="async" className={styles.heroPhoto} />
              </picture>
              <figcaption className={styles.caption}>Program. Oprawa. Wspólne emocje.</figcaption>
            </figure>
          </div>
          <div className={styles.ribbon}><span>Koncepcja i scenariusz</span><span>Koordynacja wydarzenia</span><span>Program artystyczny</span><span>Własna technika</span></div>
          <nav aria-label="Na stronie agencji" className={styles.nav}>
            {[['#wspolpraca', 'Jak pomagamy'], ['#formaty', 'Pomysły na wydarzenie'], ['#realizacje-agencji', 'Portfolio'], ['#proces', 'Przebieg współpracy'], ['#pytania', 'Pytania']].map(([href, label]) => <a key={href} href={href} className={styles.textLink}>{label}</a>)}
          </nav>
        </div>
      </header>
      {canEdit && <AgencyEditor pageSlug={pageSlug} content={content} hero={data.localHero} imageAlt={data.imageAlt} metaTitle={data.metaTitle} description={data.description} />}

      <section id="wspolpraca" className={styles.section}><div className={styles.inner}>
        <p className={styles.eyebrow}>{city ? `Organizacja eventów ${city.location}` : 'Poznaj nas jako agencję'}</p>
        <h2 className={`${styles.heading} mt-3`}>{content.localHeading}</h2>
        <div className={styles.introGrid}><div className={styles.copy}>{content.localText.split('\n').filter(Boolean).map((text, i) => <p key={i}>{text}</p>)}
          <div className={styles.teamLink}><Link href="/zespol" className={styles.textLink}>Poznaj zespół MAVINCI <ArrowUpRight size={17} aria-hidden="true" /></Link><Link href="/o-nas" className={styles.textLink}>Nasza historia i sposób pracy</Link></div>
        </div><aside className={styles.brief}><h3 className={styles.smallTitle}>Od tych pytań zaczniemy</h3><ul className={styles.checks}>{content.checks.map(item => <li key={item}><Check size={18} aria-hidden="true" /><span>{item}</span></li>)}</ul></aside></div>
      </div></section>

      <section id="formaty" className={`${styles.section} ${styles.shade}`}><div className={styles.inner}>
        <p className={styles.eyebrow}>Format wynika z celu</p><h2 className={`${styles.heading} mt-3`}>Wydarzenia, które możemy przygotować{city ? ` ${city.location}` : ' dla Twojej firmy'}</h2>
        <div className={styles.grid3}>{content.scenarios.map((item, i) => <article key={item.title} className={styles.card}><div className={styles.cardBody}><span className={styles.number} aria-hidden="true">0{i + 1}</span><h3 className={styles.smallTitle}>{item.title}</h3><p>{item.description}</p></div></article>)}</div>
        <nav aria-label="Formaty i program wydarzeń" className={styles.formatLinks}>
          <Link href="/oferta/integracje" className={styles.textLink}>Integracje firmowe</Link>
          <Link href={city ? `/oferta/konferencje/${city.slug}` : '/oferta/konferencje'} className={styles.textLink}>Konferencje</Link>
          <Link href="/oferta/wieczory-tematyczne" className={styles.textLink}>Wieczory tematyczne</Link>
          <Link href="/oferta/quizy-teleturnieje" className={styles.textLink}>Quizy i teleturnieje</Link>
          <Link href={city ? `/oferta/kasyno/${city.slug}` : '/oferta/kasyno'} className={styles.textLink}>Kasyno eventowe</Link>
        </nav>
      </div></section>

      <section id="realizacje-agencji" className={styles.section}><div className={styles.inner}>
        <p className={styles.eyebrow}>Zobacz wydarzenia i zakres naszej pracy</p><h2 className={`${styles.heading} mt-3`}>Realizacje MAVINCI</h2>
        <p className={`${styles.copy} mt-5 max-w-3xl`}>Gale, spotkania biznesowe, wieczory tematyczne i produkcja techniczna. Każdy projekt ma swój program i zakres odpowiedzialności — poznaj je w opisach realizacji.</p>
        <div className={styles.grid3}>{portfolio.map(project => <article key={project.id} className={`${styles.card} ${styles.portfolio}`}>
          {project.image && <Link href={project.href} tabIndex={-1} aria-hidden="true" className="overflow-hidden"><picture>
            {project.image_metadata?.mobile?.src && <source media="(max-width: 767px)" srcSet={project.image_metadata.mobile.src} />}
            <img src={project.image_metadata?.desktop?.src || project.image} alt="" width={960} height={600} loading="lazy" decoding="async" className={styles.photo} />
          </picture></Link>}
          <div className={styles.cardBody}>{project.location && project.location !== 'Polska' && <span className={styles.place}>Miejsce realizacji: {project.location}</span>}
            <h3 className={styles.smallTitle}><Link href={project.href}>{project.title}</Link></h3><p className="whitespace-pre-line">{project.description}</p>
            <Link href={project.href} className={styles.textLink}>Poznaj realizację <ArrowUpRight size={17} aria-hidden="true" /></Link>
          </div>
        </article>)}</div>
        <Link href="/portfolio" className={`${styles.textLink} mt-6`}>Zobacz całe portfolio</Link>
      </div></section>

      <section className={`${styles.section} ${styles.shade}`}><div className={`${styles.inner} ${styles.equipment}`}>
        <div className={styles.equipmentVisual}><ExpertiseImage type="technika" /></div>
        <div><p className={styles.eyebrow}>Pomysł ma swoje zaplecze</p><h2 className={`${styles.heading} mt-3`}>Agencja z własną techniką</h2>
          <p className={`${styles.copy} mt-5`}>Przygotowując program, od razu myślimy o jego realizacji: słyszalności prowadzącego, świetle na scenie, obrazie i zmianach między punktami. Własny park urządzeń pozwala połączyć tę pracę w jednym planie.</p>
          <ul className={styles.checks}>{['Nagłośnienie Meyer Sound LINA i realizacja dźwięku.', 'Oświetlenie oraz oprawa sceniczna i dekoracyjna.', 'Ekrany LED wewnętrzne i zewnętrzne, totemy oraz telewizory.', 'Streaming, kamery i multimedia dopasowane do programu.'].map(item => <li key={item}><Check size={18} aria-hidden="true" /><span>{item}</span></li>)}</ul>
          <Link href={city ? `/oferta/technika-sceniczna/${city.slug}` : '/oferta/technika-sceniczna'} className={styles.textLink}>Poznaj zaplecze techniczne <ArrowUpRight size={17} aria-hidden="true" /></Link>
        </div>
      </div></section>

      <section id="proces" className={styles.section}><div className={styles.inner}>
        <p className={styles.eyebrow}>Współpraca krok po kroku</p><h2 className={`${styles.heading} mt-3`}>Od pierwszej rozmowy do wydarzenia</h2>
        <ol className={styles.steps}>{agencyProcess.map((item, i) => <li key={item.title}><div className={styles.number} aria-hidden="true">0{i + 1}</div><h3 className={styles.smallTitle}>{item.title}</h3><p>{item.text}</p></li>)}</ol>
        <div className={`${styles.brief} mt-8`}><h3 className={styles.smallTitle}>Jasny podział zadań przed rozpoczęciem</h3><p className={`${styles.copy} mt-4`}>W ofercie określamy program, sprzęt, zespół, godziny pracy i zakres organizacyjny. Ustalamy również współpracę z obiektem oraz odpowiedzialność za catering, noclegi lub transport gości, jeśli są potrzebne. Dzięki temu wiesz, co obejmuje współpraca i które decyzje wymagają jeszcze uzgodnienia.</p></div>
      </div></section>

      <section id="pytania" className={`${styles.section} ${styles.shade}`}><div className={styles.inner}>
        <h2 className={styles.heading}>O co pytają organizatorzy?</h2><div className={styles.faq}>{content.faq.map((item, i) => <details key={item.question} open={i === 0}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div>
      </div></section>

      <section id="zaplanuj-event" className={styles.section}><div className={`${styles.inner} ${styles.cta}`}>
        <div><span className={styles.eyebrow}>Twój cel. Wspólny plan.</span><h2 className={`${styles.heading} mt-3`}>Zaplanujmy wydarzenie{city ? ` ${city.location}` : ''}</h2>
          <p className={styles.copy}>Podaj miasto, termin, liczbę uczestników i cel spotkania. Jeśli masz już budżet, obiekt lub wstępny pomysł, dołącz je do zapytania. Ustalimy, jak MAVINCI może pomóc w realizacji.</p>
          <div className={styles.actions}><a href={mail} className={styles.primary}>Wyślij brief wydarzenia <ArrowUpRight size={18} aria-hidden="true" /></a><a href={SITE.phoneHref} className={styles.textLink}>{SITE.telephone}</a></div>
          <Link href="/#kontakt" className={`${styles.textLink} mt-3`}>Wypełnij formularz kontaktowy</Link>
        </div>
        <div><h3 className={styles.smallTitle}>Co warto przygotować?</h3><ul className={styles.checks}>{['Cel spotkania i profil uczestników.', 'Miasto, termin i orientacyjna liczba gości.', 'Wstępny budżet oraz wybrane już elementy.', 'Oczekiwany zakres: koncepcja, organizacja, program i oprawa.'].map(item => <li key={item}><Check size={18} aria-hidden="true" /><span>{item}</span></li>)}</ul>
          <p className="text-sm leading-7 text-white/60">Biuro i magazyn: {SITE.office.street}, {SITE.office.postalCode} {SITE.office.city}.</p>
          <a href={SITE.office.mapsUrl} target="_blank" rel="noopener noreferrer" className={styles.textLink}>Dokładny dojazd do biura</a>
        </div>
      </div></section>

      <section className={styles.section}><div className={styles.inner}><h2 className={styles.heading}>Agencja eventowa dla Twojej lokalizacji</h2>
        <p className={`${styles.copy} mt-5`}>Poznaj sposób współpracy i planowania wydarzeń w wybranym mieście. Przyjmujemy również zapytania o inne miejsca w Polsce.</p>
        <nav aria-label="Miasta agencji eventowej" className={styles.cities}>{cities.map(item => <Link key={item.slug} href={`/agencja-eventowa/${item.slug}`} aria-current={item.slug === city?.slug ? 'page' : undefined} className={styles.city}><strong>{item.name}</strong><span>{item.region}<br />Organizacja eventów firmowych</span></Link>)}</nav>
        {city && <Link className={`${styles.textLink} mt-6`} href="/agencja-eventowa">MAVINCI — poznaj agencję eventową</Link>}
      </div></section>
    </main>
  </PageLayout>;
}
