import { Video, Camera, Monitor, Wifi, Layers, Radio } from 'lucide-react';
import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases: PolishCityCases;
  content: any;
};

const defaultServices = [
  {
    icon: 'Video',
    title: 'Realizacja wielokamerowa 4K',
    description:
      'Od 2 do 8 kamer jednocześnie. Kamery Sony, Blackmagic, PTZ. Reżyserka wizji z miksowaniem obrazu na żywo, replay i slow-motion.',
  },
  {
    icon: 'Wifi',
    title: 'Transmisje live na platformy',
    description:
      'YouTube Live, Vimeo, Facebook, Teams, Zoom, dedykowane CDN. Enkodery sprzętowe Teradek, LiveU. Bonding 4G/5G z redundancją łącza.',
  },
  {
    icon: 'Monitor',
    title: 'Telebimy i ściany LED',
    description:
      'Wynajem ścian LED od 1.9mm do 5.9mm pixel pitch. Telebimy wewnętrzne i zewnętrzne. Dowolna konfiguracja rozmiaru i proporcji.',
  },
  {
    icon: 'Layers',
    title: 'Oprawa graficzna live',
    description:
      'CG w czasie rzeczywistym: lower thirds, belki informacyjne, logotypy, animowane przejścia, countdown, plansza oczekiwania.',
  },
  {
    icon: 'Camera',
    title: 'Nagrywanie ISO i postprodukcja',
    description:
      'Nagranie każdej kamery osobno (ISO recording). Montaż highlightów, koloryzacja, eksport do mediów społecznościowych.',
  },
  {
    icon: 'Radio',
    title: 'Infrastruktura sieciowa',
    description:
      'Dedykowane sieci produkcyjne NDI/SDI, backbone światłowodowy, monitoring bitrate i jakości streamu. Backup każdego połączenia.',
  },
];

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Video,
  Camera,
  Monitor,
  Wifi,
  Layers,
  Radio,
};

export default function StreamingCityServices({ cityCases, content }: Props) {
  const prep = cityCases.locative_preposition || 'w';
  const heading =
    content?.services_heading ||
    `Nasze usługi streamingowe ${prep} ${capitalize(cityCases.locative)}`;

  const services =
    content?.services_json && Array.isArray(content.services_json) && content.services_json.length > 0
      ? content.services_json
      : defaultServices;

  return (
    <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <h2 className="mb-4 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          {heading}
        </h2>
        <p className="mx-auto mb-12 max-w-3xl text-center text-[#e5e4e2]/60">
          Kompleksowa obsługa techniczna transmisji i produkcji wideo na żywo
        </p>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service: any, idx: number) => {
            const IconComp = iconMap[service.icon] || Video;
            return (
              <div
                key={idx}
                className="group rounded-xl border border-[#d3bb73]/10 bg-[#0f1119] p-6 transition-all duration-300 hover:border-[#d3bb73]/40 hover:shadow-lg hover:shadow-[#d3bb73]/5"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[#d3bb73]/10 transition-colors group-hover:bg-[#d3bb73]/20">
                  <IconComp className="h-6 w-6 text-[#d3bb73]" />
                </div>
                <h3 className="mb-2 text-lg font-medium text-[#e5e4e2]">{service.title}</h3>
                <p className="text-sm leading-relaxed text-[#e5e4e2]/70">{service.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
