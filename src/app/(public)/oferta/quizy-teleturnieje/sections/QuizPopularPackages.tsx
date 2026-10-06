import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

/** This section suggests related event services; it does not imply bundled pricing. */
export default function QuizPopularPackages() {
  const links = [
    { href: '/oferta/integracje', title: 'Integracje firmowe', text: 'Zbuduj program spotkania wokół współpracy, rozrywki i wspólnych doświadczeń.' },
    { href: '/oferta/konferencje', title: 'Konferencja i wieczór', text: 'Połącz część merytoryczną z teleturniejem, korzystając ze spójnej obsługi technicznej.' },
    { href: '/oferta/wieczory-tematyczne', title: 'Wieczory tematyczne', text: 'Dopasuj pytania, oprawę i charakter rozgrywki do motywu wydarzenia.' },
  ];
  return <section className="bg-[#201019] px-5 py-12 sm:px-6 lg:py-16"><div className="mx-auto max-w-7xl"><p className="quiz-eyebrow">Więcej możliwości</p><h2 className="quiz-heading">Wpisz teleturniej w cały wieczór</h2><div className="mt-8 grid gap-4 md:grid-cols-3">{links.map(link => <Link key={link.href} href={link.href} className="rounded-2xl bg-[#160c12] p-6 transition-colors hover:bg-[#321b27]"><div className="flex items-start justify-between gap-4"><h3 className="text-lg uppercase text-[#d3bb73]">{link.title}</h3><ArrowUpRight className="shrink-0 text-[#d3bb73]" size={20} /></div><p className="mt-4 text-sm leading-relaxed text-white/70">{link.text}</p></Link>)}</div></div></section>;
}
