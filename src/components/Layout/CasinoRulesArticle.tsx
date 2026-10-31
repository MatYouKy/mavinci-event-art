import 'server-only';
import Link from 'next/link';
import type { ReactNode } from 'react';
import PageLayout from './PageLayout';
import { ServerBreadcrumb } from './ServerBreadcrumb';
import type { PublishedCasinoRule } from '@/lib/SEO/casinoRules.server';
import { SITE, WEBSITE_ID } from '@/lib/SEO/site';

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**')
    ? <strong key={index} className="font-medium text-white">{part.slice(2, -2)}</strong> : part);
}

/** Render the CMS's headings, paragraphs and lists without executing stored HTML. */
function RulesContent({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const Tag = heading[1].length <= 2 ? 'h2' : 'h3';
      blocks.push(<Tag key={i} className={Tag === 'h2' ? 'pt-6 text-2xl font-light uppercase text-[#d3bb73]' : 'pt-3 text-xl font-medium text-white'}>{inline(heading[2])}</Tag>);
      i++; continue;
    }
    const ordered = /^\d+[.)]\s+/.test(line);
    const bullet = /^[-*]\s+/.test(line);
    if (ordered || bullet) {
      const start = i;
      const items: ReactNode[] = [];
      const pattern = ordered ? /^(\d+)[.)]\s+(.+)$/ : /^[-*]\s+(.+)$/;
      while (i < lines.length) {
        const match = lines[i].trim().match(pattern);
        if (!match) break;
        items.push(<li key={i} value={ordered ? Number(match[1]) : undefined} className="pl-1">{inline(match[ordered ? 2 : 1])}</li>);
        i++;
      }
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(<Tag key={start} className={`space-y-3 pl-6 text-white/80 ${ordered ? 'list-decimal' : 'list-disc'}`}>{items}</Tag>);
      continue;
    }
    const start = i;
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|[-*]\s|\d+[.)]\s)/.test(lines[i].trim())) {
      paragraph.push(lines[i].trim()); i++;
    }
    blocks.push(<p key={start} className="text-white/80">{inline(paragraph.join(' '))}</p>);
  }
  return <div className="space-y-5 leading-7">{blocks}</div>;
}

export default function CasinoRulesArticle({ rule }: { rule: PublishedCasinoRule }) {
  const pageSlug = rule.path.slice(1);
  const url = `${SITE.url}${rule.path}`;
  const labels = { [rule.route]: rule.game_name, zasady: 'Zasady kasyna eventowego' };
  const schema = { '@context': 'https://schema.org', '@type': 'WebPage', '@id': `${url}#webpage`,
    url, name: `${rule.game_name} — zasady kasyna eventowego`, description: rule.short_description,
    inLanguage: 'pl-PL', isPartOf: { '@id': WEBSITE_ID } };
  return <PageLayout pageSlug={pageSlug} customSchema={schema} breadcrumbLabels={labels}>
    <main className="min-h-screen bg-[#190f1b] text-[#e5e4e2]">
      <article className="mx-auto max-w-4xl px-5 pb-20 pt-28 sm:px-6 md:pt-36">
        <ServerBreadcrumb pageSlug={pageSlug} labels={labels} />
        <h1 className="mt-8 text-3xl font-light uppercase sm:text-4xl">{rule.game_name} — <span className="text-[#d3bb73]">zasady gry</span></h1>
        {rule.short_description && <p className="mt-5 text-lg leading-8 text-white/75">{rule.short_description}</p>}
        <p className="mt-6 rounded-xl bg-white/[0.045] p-5 text-sm leading-7 text-white/75">W kasynie eventowym MAVINCI gramy dla rozrywki i integracji, bez zakładów pieniężnych. Poniższe zasady pomagają poznać przebieg gry; szczegóły zabawy na wydarzeniu wyjaśnia krupier.</p>
        <div className="mt-8 rounded-2xl bg-white/[0.035] px-5 pb-8 pt-3 sm:px-8"><RulesContent content={rule.rules_content} /></div>
        <section className="mt-10 rounded-2xl bg-[#341624] p-6 sm:p-8">
          <h2 className="text-2xl font-light uppercase">Kasyno rozrywkowe na wydarzeniu firmowym</h2>
          <p className="mt-4 leading-7 text-white/75">Poznaj ofertę stołów i obsługi. Dobór gier, godziny pracy oraz program uzgadniamy dla konkretnej imprezy.</p>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/oferta/kasyno" className="inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">Oferta kasyna eventowego</Link>
            <Link href="/oferta/kasyno/zasady" className="inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">Zasady pozostałych gier</Link>
            <Link href="/#kontakt" className="inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">Zapytaj o termin i wycenę</Link>
          </div>
        </section>
      </article>
    </main>
  </PageLayout>;
}
