import 'server-only';
import { getIconFunction } from '@/lib/conferenceIcons';

type Step = { id: string; icon_name?: string | null; step_title: string; step_description: string; duration_info?: string | null };

/** Public city pages have no process editor; their content needs no client boundary. */
export function ConferenceProcessSection({ process }: { process: Step[] }) {
  if (!process.length) return null;
  return <section className="px-6 py-12 md:px-12 lg:px-16">
    <div className="mx-auto max-w-5xl">
      <h2 className="mb-4 text-center text-4xl font-light text-[#e5e4e2]">Proces współpracy</h2>
      <p className="mb-16 text-center text-[#e5e4e2]/60">Krok po kroku do profesjonalnej realizacji</p>
      <ol className="space-y-6">
        {process.map(step => {
          const Icon = getIconFunction(step.icon_name);
          return <li key={step.id} className="flex flex-col items-center gap-3 md:flex-row md:items-start md:gap-6">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#d3bb73] md:h-16 md:w-16"><Icon className="h-4 w-4 text-[#1c1f33] md:h-8 md:w-8" aria-hidden="true" /></div>
            <div className="flex min-w-0 flex-1 flex-col items-center md:block">
              <div className="mb-2 flex flex-wrap items-center justify-center gap-3 md:justify-start">
                <h3 className="text-center text-base font-medium text-[#e5e4e2] md:text-left md:text-2xl">{step.step_title}</h3>
                {step.duration_info && <span className="hidden rounded-full bg-[#d3bb73]/10 px-3 py-1 text-sm text-[#d3bb73] md:inline-block">{step.duration_info}</span>}
              </div>
              <p className="text-justify text-xs text-[#e5e4e2]/70 md:text-left md:text-base">{step.step_description}</p>
              {step.duration_info && <span className="mt-2 rounded-full bg-[#d3bb73]/10 px-3 py-1 text-xs text-[#d3bb73] md:hidden">{step.duration_info}</span>}
            </div>
          </li>;
        })}
      </ol>
    </div>
  </section>;
}
