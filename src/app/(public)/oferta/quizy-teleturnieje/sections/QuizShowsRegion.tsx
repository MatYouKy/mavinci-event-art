import Link from 'next/link';
import { SITE } from '@/lib/SEO/site';
import { getPublishedQuizCities, QUIZ_PATH, type QuizCity } from '@/lib/quiz-shows/content';

export default function QuizShowsRegion({ city }: { city?: QuizCity }) {
  return <section className="px-5 py-12 sm:px-6 lg:py-16"><div className="mx-auto max-w-7xl rounded-2xl bg-[#25131c] p-6 sm:p-9">
    <p className="quiz-eyebrow">Miejsce i organizacja</p>
    <h2 className="quiz-heading">{city ? `Teleturniej firmowy ${city.location} — od czego zacząć?` : 'Olsztyn, Warmia i Mazury oraz cała Polska'}</h2>
    <p className="mt-5 max-w-4xl leading-relaxed text-white/75">{city?.planning || 'Przygotowujemy quizy na spotkania w hotelach, salach konferencyjnych i siedzibach firm. Nasze biuro i magazyn znajdują się przy ul. Towarowej 20B w Olsztynie. Zakres dojazdu, montażu i wyposażenia ustalamy dla konkretnego wydarzenia.'}</p>
    {city && <ul className="mt-5 max-w-4xl space-y-3 text-sm leading-relaxed text-white/75">{city.checks.map(item => <li key={item} className="flex gap-3"><span aria-hidden="true" className="text-[#d3bb73]">•</span>{item}</li>)}</ul>}
    <nav aria-label="Lokalizacje teleturniejów" className="mt-6 flex flex-wrap gap-3">
      {city && <Link href={QUIZ_PATH} className="quiz-button-secondary">Wszystkie formaty teleturniejów</Link>}
      {getPublishedQuizCities().filter(item => item.slug !== city?.slug).map(item => <Link key={item.slug} href={`${QUIZ_PATH}/${item.slug}`} className="quiz-button-secondary">Quizy i teleturnieje — {item.name}</Link>)}
      <a href={SITE.office.mapsUrl} className="quiz-button-secondary">Dojazd do biura MAVINCI</a>
    </nav>
  </div></section>;
}
