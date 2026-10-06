import { Users, Utensils, Mic2 } from 'lucide-react';

export default function QuizShowsIntro() {
  const occasions = [
    { Icon: Users, title: 'Integracja zespołu', text: 'Wspólna odpowiedź, dyskusja i emocje przy wyniku. Dobieramy pytania tak, aby mogły włączyć się osoby z różnych działów.' },
    { Icon: Utensils, title: 'Kolacja firmowa', text: 'Rozgrywka wpisana w rytm wieczoru. Ustalamy rundy i przerwy z organizatorem, uwzględniając serwis dań i inne atrakcje.' },
    { Icon: Mic2, title: 'Wieczór po konferencji', text: 'Zmiana tempa po części merytorycznej. Pytania, multimedia i prowadzenie mogą nawiązywać do tematu spotkania lub marki.' },
  ];
  return <section className="px-5 py-12 sm:px-6 lg:py-16" aria-labelledby="quiz-occasions-title">
    <div className="mx-auto max-w-7xl">
      <div className="mb-7 max-w-3xl"><p className="quiz-eyebrow">Wspólna gra, wspólne emocje</p><h2 id="quiz-occasions-title" className="quiz-heading">Rozrywka z miejscem w programie</h2></div>
      <div className="grid gap-4 md:grid-cols-3">{occasions.map(({ Icon, title, text }) => <article key={title} className="rounded-2xl bg-white/[0.035] p-5 sm:p-6"><Icon className="mb-4 text-[#d3bb73]" size={26} strokeWidth={1.5} /><h3 className="text-lg uppercase">{title}</h3><p className="mt-3 text-sm leading-relaxed text-white/70">{text}</p></article>)}</div>
    </div>
  </section>;
}
