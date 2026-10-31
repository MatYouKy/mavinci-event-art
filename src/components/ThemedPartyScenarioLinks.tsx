import 'server-only';
import Link from 'next/link';
import { getPublishedThemedPartyScenarios } from '@/lib/SEO/themedPartyScenarios.server';
import { SCENARIO_PATH } from '@/lib/SEO/themedPartyScenarios';

export default async function ThemedPartyScenarioLinks({ projectId }: { projectId?: string }) {
  const published = await getPublishedThemedPartyScenarios();
  const scenarios = projectId ? published.filter(item => item.projectIds.includes(projectId)) : published;
  if (!scenarios.length) return null;
  return <section className="mx-auto max-w-7xl px-5 py-12 text-[#e5e4e2] sm:px-6">
    <h2 className="text-2xl font-light uppercase">{projectId ? 'Poznaj scenariusze wykorzystujące podobną oprawę' : 'Wybierz motyw i poznaj program wieczoru'}</h2>
    <p className="mt-4 max-w-3xl leading-7 text-white/75">Sprawdź, jak połączyć część firmową z muzyką i atrakcjami. Każdy opis zawiera propozycję przebiegu, zakres do ustalenia oraz powiązane realizacje MAVINCI.</p>
    <div className="mt-7 grid gap-4 md:grid-cols-3">{scenarios.map(item => <article key={item.slug} className="rounded-2xl bg-[#291320] p-6">
      <h3 className="text-lg text-[#d3bb73]"><Link href={item.href} className="hover:underline">{item.label}</Link></h3>
      <p className="mt-3 text-sm leading-6 text-white/75">{item.content.occasion}</p>
      <Link href={item.href} className="mt-4 inline-flex min-h-11 items-center text-sm text-[#d3bb73] underline underline-offset-4">Program, oprawa i realizacje ↗</Link>
    </article>)}</div>
    {projectId && <Link href={SCENARIO_PATH} className="mt-5 inline-flex min-h-11 items-center text-sm text-[#d3bb73] underline underline-offset-4">Porównaj motywy wieczorów</Link>}
  </section>;
}
