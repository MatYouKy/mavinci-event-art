import Link from 'next/link';

const questions = [
  ['Co obejmuje organizacja eventu firmowego w Olsztynie?', 'Zakres ustalamy na podstawie celu wydarzenia, terminu, miejsca i liczby uczestników. Możemy przygotować koncepcję i scenariusz, koordynację realizacji, obsługę techniczną oraz część rozrywkową. W ofercie wyszczególniamy zamówione elementy.'],
  ['Od czego zależy koszt organizacji lub obsługi wydarzenia?', 'Cena zależy od liczby uczestników, czasu pracy, warunków obiektu, potrzebnego sprzętu i programu. Sama obsługa nagłośnienia ma inny zakres niż organizacja konferencji z wieczorem integracyjnym. Do wyceny podaj termin, miejsce i planowany zakres.'],
  ['Czy można zamówić samą obsługę techniczną?', 'Tak. Zapewniamy zarówno kompleksową organizację wydarzenia, jak i wybrany zakres: nagłośnienie, oświetlenie, ekrany LED, multimedia lub streaming. Konfigurację dopasowujemy do programu i miejsca.'],
  ['Z jakiego nagłośnienia korzysta MAVINCI?', 'W naszym parku urządzeń znajduje się system Meyer Sound LINA. Dobór nagłośnienia zależy od wielkości i akustyki przestrzeni, rodzaju wydarzenia oraz wymagań technicznych.'],
  ['Czy po konferencji możecie przygotować część rozrywkową?', 'Tak. Łączymy obsługę konferencji z bankietem, oprawą muzyczną, wieczorem tematycznym, kasynem eventowym albo quizami i teleturniejami. Zakres ustalamy wspólnie na etapie scenariusza.'],
  ['Gdzie działacie?', 'Naszą bazą jest Olsztyn: biuro i magazyn przy ul. Towarowej 20B. Obsługujemy Warmię i Mazury oraz realizujemy wydarzenia w innych regionach Polski. Możliwości dojazdu i montażu ustalamy dla danego miejsca i terminu.'],
  ['Co przesłać do wyceny wydarzenia?', 'Podaj termin, miasto i obiekt, przewidywaną liczbę uczestników oraz rodzaj wydarzenia. Przydatne są harmonogram, zakres potrzebnych usług i orientacyjny budżet. Jeżeli program nie jest jeszcze gotowy, pomożemy dobrać rozwiązania.'],
];

export default function HomeQuestions() {
  return <section className="bg-[#160c19] px-6 py-20 text-[#e5e4e2]" aria-labelledby="home-questions">
    <div className="mx-auto max-w-4xl">
      <h2 id="home-questions" className="mb-8 text-3xl font-light uppercase">Organizacja eventu — pytania i odpowiedzi</h2>
      <div className="space-y-6">{questions.map(([question, answer]) => <article key={question} className="rounded-2xl bg-white/5 p-6">
        <h3 className="text-lg uppercase text-[#d3bb73]">{question}</h3><p className="mt-3 leading-relaxed text-white/75">{answer}</p>
      </article>)}</div>
      <Link className="mt-8 inline-block text-[#d3bb73] underline underline-offset-4" href="/#kontakt">Zapytaj o swój event</Link>
    </div>
  </section>;
}
