import OfferLayout from '../OfferLayout';
import { getQuizData, getQuizHero, quizMetadata, quizSchema } from '@/lib/quiz-shows/server';
import { QUIZ_PATH } from '@/lib/quiz-shows/content';
import QuizyTeleturniejePage from './QuizyTeleturniejePage';
import './quiz-shows.css';

export const dynamic = 'force-dynamic';
export function generateMetadata() { return quizMetadata(); }

export default async function Page() {
  const [data, hero] = await Promise.all([getQuizData(), getQuizHero()]);
  return <main className="quiz-page"><OfferLayout pageSlug={QUIZ_PATH.slice(1)} section="quizy-teleturnieje-hero"
    initialTitle={hero.title} initialDescription={hero.description} initialImageUrl={hero.image} whiteWordsCount={3} customSchema={quizSchema()}>
    <QuizyTeleturniejePage {...data} />
  </OfferLayout></main>;
}
