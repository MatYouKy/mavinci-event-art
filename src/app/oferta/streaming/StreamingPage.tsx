'use client';

import StreamingHero from './sections/StreamingHero';
import StreamingBenefits from './sections/StreamingBenefits';
import StreamingTech from './sections/StreamingTech';
import StreamingGallery from './sections/StreamingGallery';
import StreamingCTA from './sections/StreamingCTA';

export default function StreamingPage() {
  return (
    <main className="min-h-screen bg-[#0f1119]">
      {/* Benefits Section */}
      <StreamingBenefits />

      {/* Tech Section */}
      <StreamingTech />

      {/* Gallery Section */}
      <StreamingGallery />

      {/* CTA Section */}
      <StreamingCTA />
    </main>
  );
}
