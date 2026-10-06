import type { QuizGalleryImage, QuizShowFormat } from '@/lib/quiz-shows/types';
import type { QuizCity } from '@/lib/quiz-shows/content';
import QuizShowsIntro from './sections/QuizShowsIntro';
import QuizShowsTypes from './sections/QuizShowsTypes';
import QuizShowsFeatures from './sections/QuizShowsFeatures';
import QuizShowsGallery from './sections/QuizShowsGallery';
import QuizPopularPackages from './sections/QuizPopularPackages';
import QuizShowsCTA from './sections/QuizShowsCTA';
import QuizShowsPlanning from './sections/QuizShowsPlanning';
import QuizShowsFAQ from './sections/QuizShowsFAQ';
import QuizShowsRegion from './sections/QuizShowsRegion';

export default function QuizyTeleturniejePage({ formats, gallery, city }: {
  formats: QuizShowFormat[]; gallery: QuizGalleryImage[]; city?: QuizCity;
}) {
  return <>
    <nav aria-label="Sekcje oferty teleturniejów" className="mx-auto flex max-w-7xl flex-wrap gap-3 px-5 pt-7 sm:px-6"><a href="#formaty" className="quiz-button-primary">Wybierz format</a><a href="#zapytaj-o-teleturniej" className="quiz-button-secondary">Zaplanuj wydarzenie</a></nav>
    {city && <QuizShowsRegion city={city} />}
    <QuizShowsIntro />
    <QuizShowsTypes initialFormats={formats} />
    <QuizShowsFeatures />
    <QuizShowsPlanning />
    <QuizShowsGallery initialImages={gallery} />
    <QuizPopularPackages />
    <QuizShowsFAQ city={city} />
    {!city && <QuizShowsRegion />}
    <QuizShowsCTA location={city?.location} />
  </>;
}
