'use client';

import { Video, CircuitBoard, Mic2, Lightbulb, Cable, HardDrive } from 'lucide-react';

interface TechItem {
  icon: React.ReactNode;
  name: string;
  description: string;
}

interface StreamingTechProps {
  title?: string;
  description?: string;
  techItems?: TechItem[];
}

const defaultTechItems: TechItem[] = [
  {
    icon: <Video className="h-6 w-6" />,
    name: 'Kamery Sony / Blackmagic 4K',
    description: 'Profesjonalne kamery broadcastowe zapewniające obraz najwyższej jakości',
  },
  {
    icon: <CircuitBoard className="h-6 w-6" />,
    name: 'Miksery Roland V-8HD / V-160HD',
    description: 'Zaawansowane miksery wideo do płynnego przełączania między źródłami',
  },
  {
    icon: <CircuitBoard className="h-6 w-6" />,
    name: 'Blackmagic Web Presenter',
    description: 'Dedykowane urządzenie do streamingu zapewniające stabilność transmisji',
  },
  {
    icon: <Mic2 className="h-6 w-6" />,
    name: 'Mikrofony Shure / Sennheiser',
    description: 'Studyjne mikrofony gwarantujące krystalicznie czysty dźwięk',
  },
  {
    icon: <Lightbulb className="h-6 w-6" />,
    name: 'Światło LED studyjne',
    description: 'Profesjonalne oświetlenie LED do idealnej ekspozycji obrazu',
  },
  {
    icon: <Cable className="h-6 w-6" />,
    name: 'Okablowanie SDI i backup nagrań',
    description: 'Profesjonalne przewody SDI oraz system zapasowych nagrań lokalnych',
  },
];

export default function StreamingTech({
  title = 'Sprzęt transmisyjny',
  description = 'Używamy wyłącznie profesjonalnego sprzętu broadcastowego, który gwarantuje najwyższą jakość transmisji i niezawodność realizacji.',
  techItems = defaultTechItems,
}: StreamingTechProps) {
  return (
    <section className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] px-6 py-24">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-4xl font-light text-[#e5e4e2] md:text-5xl">
            {title}
          </h2>
          <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
          <p className="mx-auto max-w-3xl text-lg font-light leading-relaxed text-[#e5e4e2]/70">
            {description}
          </p>
        </div>

        {/* Tech Items */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {techItems.map((item, index) => (
            <div
              key={index}
              className="group relative overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#0f1119]/50 backdrop-blur-sm transition-all duration-300 hover:border-[#d3bb73]/30"
            >
              <div className="flex items-start gap-4 p-6">
                {/* Icon */}
                <div className="flex-shrink-0">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#d3bb73]/10 text-[#d3bb73] ring-1 ring-[#d3bb73]/20 transition-all duration-300 group-hover:bg-[#d3bb73]/20 group-hover:scale-110">
                    {item.icon}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1">
                  <h3 className="mb-2 text-lg font-light text-[#e5e4e2]">
                    {item.name}
                  </h3>
                  <p className="text-sm font-light leading-relaxed text-[#e5e4e2]/60">
                    {item.description}
                  </p>
                </div>
              </div>

              {/* Hover Effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            </div>
          ))}
        </div>

        {/* Bottom Note */}
        <div className="mt-12 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/20 bg-[#d3bb73]/5 px-6 py-3 backdrop-blur-sm">
            <HardDrive className="h-5 w-5 text-[#d3bb73]" />
            <span className="text-sm font-light text-[#e5e4e2]/70">
              + Zapasowe zasilanie i redundancja połączeń
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
