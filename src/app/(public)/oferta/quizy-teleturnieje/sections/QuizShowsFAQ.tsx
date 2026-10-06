import { quizFaq, type QuizCity } from '@/lib/quiz-shows/content';

export default function QuizShowsFAQ({ city }: { city?: QuizCity }) {
  const items = [...(city?.faq || []), ...quizFaq];
  return <section className="px-5 py-12 sm:px-6 lg:py-20"><div className="mx-auto max-w-4xl">
    <p className="quiz-eyebrow">Przed rezerwacją</p><h2 className="quiz-heading">Pytania organizatorów</h2>
    <div className="mt-8 space-y-3">{items.map(item => <details key={item.question} className="group rounded-2xl bg-white/[0.045] px-5 py-4 sm:px-6"><summary className="cursor-pointer py-2 text-base font-medium text-[#e5e4e2] marker:text-[#d3bb73]">{item.question}</summary><p className="pb-2 pt-3 text-sm leading-relaxed text-white/70 sm:text-base">{item.answer}</p></details>)}</div>
  </div></section>;
}
