import { notFound } from 'next/navigation';
import OfferLayout from '../../OfferLayout';
import { getQuizCity, getPublishedQuizCities, QUIZ_PATH } from '@/lib/quiz-shows/content';
import { getQuizData, getQuizHero, quizMetadata, quizSchema } from '@/lib/quiz-shows/server';
import QuizyTeleturniejePage from '../QuizyTeleturniejePage';
import '../quiz-shows.css';

export const dynamic = 'force-dynamic';
export function generateStaticParams() { return getPublishedQuizCities().map(city => ({ miasto: city.slug })); }
export function generateMetadata({ params }: { params: { miasto: string } }) {
  const city = getQuizCity(params.miasto);
  if (!city) return { title: { absolute: 'Nie znaleziono strony | MAVINCI' }, robots: { index: false, follow: false } };
  return quizMetadata(city);
}
export default async function QuizCityPage({ params }: { params: { miasto: string } }) {
  const city = getQuizCity(params.miasto);
  if (!city) notFound();
  const [data, hero] = await Promise.all([getQuizData(), getQuizHero(city)]);
  return <main className="quiz-page"><OfferLayout pageSlug={`${QUIZ_PATH.slice(1)}/${city.slug}`} section="quizy-teleturnieje-hero"
    initialTitle={hero.title} initialDescription={hero.description} initialImageUrl={hero.image} whiteWordsCount={3} customSchema={quizSchema(city)}>
    <QuizyTeleturniejePage {...data} city={city} />
  </OfferLayout></main>;
}
