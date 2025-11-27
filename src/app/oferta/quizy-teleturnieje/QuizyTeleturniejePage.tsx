import { Metadata } from 'next';
import QuizShowsIntro from './sections/QuizShowsIntro';
import QuizShowsTypes from './sections/QuizShowsTypes';
import QuizShowsFeatures from './sections/QuizShowsFeatures';
import QuizShowsGallery from './sections/QuizShowsGallery';
import QuizPopularPackages from './sections/QuizPopularPackages';
import QuizShowsCTA from './sections/QuizShowsCTA';

export const metadata: Metadata = {
  title: 'Quizy i Teleturnieje | Mavinci',
  description: 'Profesjonalne teleturnieje i quizy na eventy firmowe i gale premium. Od prostych quizów po multimedialne widowiska z pilotami i buzzerami. Integracje firmowe przez rywalizację.',
  keywords: 'teleturnieje, quizy firmowe, teleturnieje multimedialne, piloty do głosowania, buzzery, integracje firmowe, gale premium, eventy korporacyjne',
};

export default function QuizyTeleturniejePage() {
  return (
    <main className="min-h-screen bg-[#0f1119]">
      {/* Intro Section - Opis oferty */}
      <QuizShowsIntro />

      {/* Types Section - 6 formatów teleturniejów */}
      <QuizShowsTypes />

      {/* Features Section - Co zapewniamy */}
      <QuizShowsFeatures />

      {/* Gallery Section - Realizacje */}
      <QuizShowsGallery />

      {/* Popular Packages Section - Karuzela */}
      <QuizPopularPackages />

      {/* CTA Section - Kontakt */}
      <QuizShowsCTA />
    </main>
  );
}
