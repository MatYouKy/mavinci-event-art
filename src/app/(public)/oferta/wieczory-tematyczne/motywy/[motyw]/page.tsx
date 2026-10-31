import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import PageLayout from '@/components/Layout/PageLayout';
import { ServerBreadcrumb } from '@/components/Layout/ServerBreadcrumb';
import ThemedPartyBriefForm from '@/components/ThemedPartyBriefForm';
import ConferenceContactLink from '@/components/ConferenceContactLink';
import { getUserPermissions } from '@/lib/serverAuth';
import { getThemedPartyScenario } from '@/lib/SEO/themedPartyScenarios.server';
import { OLSZTYN_THEMED_PARTY_PATH } from '@/lib/SEO/themedPartyContent';
import { ORGANIZATION_ID, SITE, WEBSITE_ID } from '@/lib/SEO/site';
import ThemedPartyScenarioEditor from './ThemedPartyScenarioEditor';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const section = 'mx-auto max-w-7xl px-5 py-12 sm:px-6 md:py-16';
const heading = 'text-2xl font-light uppercase leading-snug sm:text-3xl';
const link = 'inline-flex min-h-11 items-center text-[#d3bb73] underline decoration-[#d3bb73]/40 underline-offset-4 hover:decoration-[#d3bb73]';

export async function generateMetadata({ params }: { params: { motyw: string } }): Promise<Metadata> {
  const data = await getThemedPartyScenario(params.motyw);
  if (!data) return { title: 'Nie znaleziono motywu | MAVINCI', robots: { index: false } };
  const { content, canonicalUrl } = data;
  return { title: { absolute: content.metaTitle }, description: content.description,
    alternates: { canonical: canonicalUrl }, robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large' } },
    openGraph: { type: 'website', url: canonicalUrl, title: content.metaTitle, description: content.description, siteName: SITE.name, locale: 'pl_PL', ...(data.image && { images: [{ url: data.image, alt: data.alt }] }) },
    twitter: { card: 'summary_large_image', title: content.metaTitle, description: content.description, ...(data.image && { images: [data.image] }) },
  };
}

export default async function ThemedPartyScenarioPage({ params }: { params: { motyw: string } }) {
  const data = await getThemedPartyScenario(params.motyw);
  if (!data) notFound();
  const { hasWebsiteEdit } = await getUserPermissions();
  const { content, canonicalUrl: url } = data;
  const labels = { motywy: 'Motywy wieczorów', [data.slug]: data.label };
  const schema = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: content.metaTitle, description: content.description, inLanguage: 'pl-PL', isPartOf: { '@id': WEBSITE_ID }, mainEntity: { '@id': `${url}#service` }, ...(data.image && { primaryImageOfPage: { '@type': 'ImageObject', url: data.image, caption: data.alt } }) },
    { '@type': 'Service', '@id': `${url}#service`, url, name: content.title, description: content.lead, ...(data.image && { image: data.image }), serviceType: 'Organizacja wieczoru tematycznego dla firm', provider: { '@id': ORGANIZATION_ID }, areaServed: [{ '@type': 'City', name: 'Olsztyn' }, { '@type': 'Country', name: 'Polska' }], audience: { '@type': 'BusinessAudience', audienceType: 'Organizatorzy wydarzeń firmowych, działy HR i agencje eventowe' } },
    ...(content.faq.length ? [{ '@type': 'FAQPage', '@id': `${url}#faq`, isPartOf: { '@id': `${url}#webpage` }, mainEntity: content.faq.map(item => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })) }] : []),
  ] };
  return <PageLayout pageSlug={data.pageSlug} customSchema={schema} breadcrumbLabels={labels}>
    <div className="bg-[#190f1b] text-[#e5e4e2]">
      <header className="bg-gradient-to-b from-[#341624] to-[#190f1b] px-5 pb-12 pt-28 sm:px-6 md:pt-36"><div className="mx-auto max-w-7xl">
        <ServerBreadcrumb pageSlug={data.pageSlug} labels={labels} />
        <div className="mt-6 grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
          <div><p className="text-sm text-[#d3bb73]">{data.label} · motyw wydarzenia firmowego</p><h1 className="mt-4 text-3xl font-light uppercase leading-tight sm:text-4xl xl:text-5xl">{content.title}</h1><p className="mt-6 text-base leading-7 text-white/80 sm:text-lg sm:leading-8">{content.lead}</p><Link href="#zapytanie" className="mt-7 inline-flex min-h-12 items-center rounded-full bg-[#d3bb73] px-6 py-3 text-sm font-medium text-[#190f1b] hover:bg-[#e3cd8c]">Zapytaj o ten motyw</Link></div>
          {data.image && <figure className="overflow-hidden rounded-3xl bg-white/[0.04] shadow-xl"><picture>{data.mobileImage && <source media="(max-width: 767px)" srcSet={data.mobileImage} />}<img src={data.image} alt={data.alt} width={1280} height={800} fetchPriority="high" loading="eager" decoding="async" className="aspect-[16/10] w-full object-cover" /></picture></figure>}
        </div>
      </div></header>
      {hasWebsiteEdit && <ThemedPartyScenarioEditor slug={data.slug} recordId={data.recordId} updatedAt={data.updatedAt} content={content} alt={data.alt} />}
      <nav aria-label="Na tej stronie" className="mx-auto flex max-w-7xl flex-wrap gap-x-6 px-5 text-sm sm:px-6">{[['#program', 'Program wieczoru'], ['#zakres', 'Zakres obsługi'], ...(data.projects.length ? [['#realizacje', 'Realizacje']] : []), ['#pytania', 'Pytania i odpowiedzi']].map(([href, label]) => <a key={href} href={href} className={link}>{label}</a>)}</nav>
      <section className={section}><h2 className={heading}>Dla jakiego wydarzenia?</h2><p className="mt-5 max-w-3xl text-lg leading-8 text-[#d3bb73]">{content.occasion}</p><p className="mt-5 max-w-4xl whitespace-pre-line leading-7 text-white/75">{content.summary}</p></section>
      <section id="program" className={`${section} scroll-mt-24`}><h2 className={heading}>Przykładowy przebieg wieczoru</h2><p className="mt-4 max-w-3xl leading-7 text-white/65">To propozycja do dopasowania. Kolejność, długość poszczególnych części i wybrane atrakcje ustalamy przed realizacją.</p><ol className="mt-8 grid gap-4 md:grid-cols-2">{content.program.map((item, index) => <li key={index} className="rounded-2xl bg-white/[0.045] p-6"><span className="text-sm text-[#d3bb73]">0{index + 1}</span><h3 className="mt-3 text-lg text-[#d3bb73]">{item.heading}</h3><p className="mt-3 text-sm leading-7 text-white/75">{item.text}</p></li>)}</ol></section>
      <section id="zakres" className="scroll-mt-24 bg-[#291320]/60"><div className={section}><h2 className={heading}>Co możemy przygotować</h2><div className="mt-8 grid gap-7 lg:grid-cols-3">{content.scope.map((item, index) => <article key={index}><h3 className="text-lg text-[#d3bb73]">{item.heading}</h3><p className="mt-4 text-sm leading-7 text-white/75">{item.text}</p></article>)}</div><p className="mt-8 max-w-3xl text-sm leading-7 text-white/60">Zakres potwierdzamy w indywidualnej ofercie. Wynajem sali, catering, noclegi i dodatkowi artyści wymagają odrębnych ustaleń.</p><div className="mt-4 flex flex-wrap gap-x-6 text-sm"><Link href="/oferta/technika-sceniczna/olsztyn" className={link}>Zaplecze techniczne MAVINCI</Link><Link href="/oferta/kasyno" className={link}>Kasyno rozrywkowe</Link><Link href="/oferta/quizy-teleturnieje" className={link}>Quizy i teleturnieje</Link></div></div></section>
      <section className={section}><h2 className={heading}>Co ustalić przed wyceną?</h2><ul className="mt-6 grid gap-4 md:grid-cols-2">{content.planning.map((item, index) => <li key={index} className="rounded-xl bg-white/[0.045] p-5 text-sm leading-7 text-white/75">{item}</li>)}</ul></section>
      {data.projects.length > 0 && <section id="realizacje" className={`${section} scroll-mt-24`}><h2 className={heading}>Doświadczenie pokazane w realizacjach</h2><p className="mt-5 max-w-3xl leading-7 text-white/75">{content.evidenceIntro}</p><div className="mt-8 grid gap-6 md:grid-cols-2">{data.projects.map(project => {
        const image = project.image_metadata?.desktop?.src || project.image;
        const mobile = project.image_metadata?.mobile?.src;
        return <article key={project.id} className="overflow-hidden rounded-2xl bg-white/[0.045]">{image && <picture>{mobile && mobile !== image && <source media="(max-width: 767px)" srcSet={mobile} />}<img src={image} width={900} height={560} alt={project.alt || project.title} loading="lazy" decoding="async" className="aspect-[16/10] w-full object-cover" /></picture>}<div className="p-6"><h3 className="text-xl text-[#d3bb73]"><Link href={project.href}>{project.title}</Link></h3><p className="mt-4 whitespace-pre-line text-sm leading-7 text-white/75">{project.description}</p><Link href={project.href} className={`${link} mt-4 text-sm`}>Zobacz zdjęcia i zakres prac ↗</Link></div></article>;
      })}</div></section>}
      <section className={section}><h2 className={heading}>Wieczory tematyczne w Olsztynie i z dojazdem</h2><p className="mt-5 max-w-3xl leading-7 text-white/75">Przygotowujemy realizacje z bazy przy ul. Towarowej 20B w Olsztynie. Obsługujemy wydarzenia w mieście, na Warmii i Mazurach oraz w innych regionach Polski. Transport, montaż i dostępność zespołu uzgadniamy dla konkretnego terminu.</p><div className="mt-4 flex flex-wrap gap-x-6 text-sm"><Link href={OLSZTYN_THEMED_PARTY_PATH} className={link}>Organizacja imprezy tematycznej w Olsztynie</Link><Link href="/oferta/wieczory-tematyczne/lokalizacje" className={link}>Pozostałe lokalizacje obsługi</Link></div></section>
      {content.faq.length > 0 && <section id="pytania" className={`${section} scroll-mt-24`}><h2 className={heading}>Pytania o ten motyw</h2><div className="mt-7 max-w-4xl space-y-3">{content.faq.map((item, index) => <details key={index} className="rounded-xl bg-white/[0.045] p-5"><summary className="cursor-pointer leading-7 text-[#d3bb73]">{item.question}</summary><p className="mt-4 text-sm leading-7 text-white/75">{item.answer}</p></details>)}</div></section>}
      <section id="zapytanie" className={`${section} scroll-mt-24`}><div className="rounded-3xl bg-[#341624] p-5 sm:p-9"><h2 className={heading}>Ustalmy program Twojego wydarzenia</h2><p className="mt-5 max-w-3xl leading-7 text-white/75">Prześlij termin, miejsce i liczbę gości. Wskaż, czy potrzebujesz całego wieczoru, czy wybranych elementów oprawy.</p><ThemedPartyBriefForm sourcePath={data.href} motif={data.label} /><div className="mt-5 flex flex-wrap gap-x-7"><ConferenceContactLink href={SITE.phoneHref} method="phone" className={link}>{SITE.telephone}</ConferenceContactLink><ConferenceContactLink href={`mailto:${SITE.email}`} method="email" className={`${link} break-all`}>{SITE.email}</ConferenceContactLink></div></div></section>
      {data.related.length > 0 && <nav aria-label="Inne motywy wieczorów" className={section}><h2 className="text-xl font-light uppercase">Porównaj inne motywy</h2><div className="mt-4 flex flex-wrap gap-x-7">{data.related.map(item => <Link key={item.slug} href={item.href} className={link}>{item.label}</Link>)}</div></nav>}
    </div>
  </PageLayout>;
}
