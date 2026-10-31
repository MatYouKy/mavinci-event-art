import { getIconFunction } from '@/lib/conferenceIcons';

type Props = { advantages: { id: string; icon_name?: string | null; title: string; description: string }[] };

/** One responsive markup for the server, mobile and desktop. */
export function AdvantagesSection({ advantages }: Props) {
  return <section className="bg-[#1c1f33]/30 px-6 py-12 md:px-12 md:py-20">
    <div className="mx-auto max-w-7xl">
      <h2 className="mb-8 text-center text-4xl font-light text-[#e5e4e2] md:mb-16">Dlaczego <span className="text-[#d3bb73]">MAVINCI?</span></h2>
      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        {advantages.map(adv => {
          const Icon = getIconFunction(adv.icon_name);
          return <div key={adv.id} className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2 md:grid-cols-[3rem_minmax(0,1fr)] md:items-start md:gap-x-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d3bb73] md:row-span-2 md:h-12 md:w-12"><Icon className="h-4 w-4 text-[#1c1f33] md:h-6 md:w-6" aria-hidden="true" /></div>
            <h3 className="text-base font-medium text-[#e5e4e2] md:text-xl">{adv.title}</h3>
            <p className="col-span-2 text-xs text-[#e5e4e2]/70 md:col-span-1 md:col-start-2 md:text-sm">{adv.description}</p>
          </div>;
        })}
      </div>
    </div>
  </section>;
}
