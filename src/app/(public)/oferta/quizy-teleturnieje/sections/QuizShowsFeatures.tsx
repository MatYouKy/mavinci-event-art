import { Monitor, Mic2, Volume2, Palette, Video, Trophy } from 'lucide-react';

export default function QuizShowsFeatures() {
  const features = [
    { Icon: Mic2, title: 'Prowadzący i realizacja', description: 'Ustalamy zasady, sposób prowadzenia i obsługę rozgrywki. Organizator otrzymuje konkretny plan przebiegu teleturnieju.' },
    { Icon: Monitor, title: 'Pytania i wyniki na ekranie', description: 'Dobieramy ekran LED lub projekcję do sali. Sprawdzamy czytelność pytań i rankingu z miejsc zajmowanych przez gości.' },
    { Icon: Volume2, title: 'Własne nagłośnienie', description: 'Korzystamy z własnego zaplecza, w tym systemu Meyer Sound. Zakres nagłośnienia i mikrofonów dobieramy do przestrzeni oraz formatu.' },
    { Icon: Palette, title: 'Pytania o Waszą firmę', description: 'Możemy wykorzystać historię, produkty, zdjęcia i identyfikację wizualną marki. Materiały uzgadniamy przed wydarzeniem.' },
    { Icon: Video, title: 'Multimedia i obraz', description: 'Rundy audio i wideo mogą urozmaicić scenariusz. Nagranie, realizację kamerową i streaming wyceniamy zgodnie z potrzebami wydarzenia.' },
    { Icon: Trophy, title: 'Finał i nagrody', description: 'Uzgadniamy sposób ogłoszenia wyników oraz wręczenia nagród. Nagrody i dodatkowa scenografia wymagają osobnego ustalenia zakresu.' },
  ];
  return <section className="bg-[#201019] px-5 py-12 sm:px-6 lg:py-20" aria-labelledby="quiz-production-title"><div className="mx-auto max-w-7xl">
    <div className="mb-8 max-w-3xl"><p className="quiz-eyebrow">Pomysł i własne zaplecze techniczne</p><h2 id="quiz-production-title" className="quiz-heading">Zabawa, za którą stoi realizacja</h2><p className="mt-4 leading-relaxed text-white/70">Łączymy scenariusz z dźwiękiem, obrazem i prowadzeniem. W propozycji dla Twojego wydarzenia określamy dokładnie, które elementy obejmuje realizacja.</p></div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{features.map(({ Icon, title, description }) => <article key={title} className="rounded-2xl bg-[#160c12] p-6"><Icon className="mb-5 text-[#d3bb73]" size={25} strokeWidth={1.5} /><h3 className="text-lg uppercase">{title}</h3><p className="mt-3 text-sm leading-relaxed text-white/70">{description}</p></article>)}</div>
  </div></section>;
}
