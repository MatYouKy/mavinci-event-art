export default function QuizShowsPlanning() {
  const steps = [
    ['Poznajemy wydarzenie', 'Ustalamy cel spotkania, liczbę gości, układ sali i czas na rozgrywkę.'],
    ['Dobieramy scenariusz', 'Wybieramy format, rundy i sposób udziału. Uzgadniamy pytania firmowe oraz materiały.'],
    ['Przygotowujemy technikę', 'Planujemy montaż, próbę dźwięku i obrazu oraz współpracę z obsługą obiektu.'],
    ['Prowadzimy rozgrywkę', 'Wyjaśniamy zasady, realizujemy rundy i finał zgodnie z uzgodnionym programem.'],
  ];
  return <section className="px-5 py-12 sm:px-6 lg:py-20"><div className="mx-auto max-w-7xl">
    <p className="quiz-eyebrow">Od pomysłu do finału</p><h2 className="quiz-heading">Jak przygotowujemy teleturniej?</h2>
    <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{steps.map(([title, text], i) => <li key={title} className="rounded-2xl bg-white/[0.035] p-6"><span aria-hidden="true" className="text-3xl text-[#d3bb73]/60">0{i + 1}</span><h3 className="mt-4 text-base uppercase">{title}</h3><p className="mt-3 text-sm leading-relaxed text-white/70">{text}</p></li>)}</ol>
  </div></section>;
}
