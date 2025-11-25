'use client';

import IntegrationsHero from './sections/IntegrationsHero';
import IntegrationsTypes from './sections/IntegrationsTypes';
import IntegrationsBenefits from './sections/IntegrationsBenefits';
import IntegrationsGallery from './sections/IntegrationsGallery';
import IntegrationsProcess from './sections/IntegrationsProcess';
import IntegrationsCTA from './sections/IntegrationsCTA';

export default function IntegracjePage() {
  return (
    <main className="min-h-screen bg-[#0f1119]">
      {/* Hero Section */}
      <IntegrationsHero />

      {/* Types Section - Kafelki z rodzajami integracji */}
      <IntegrationsTypes />

      {/* Benefits Section - Korzyści */}
      <IntegrationsBenefits />

      {/* Gallery Section - Galeria zdjęć */}
      <IntegrationsGallery />

      {/* Process Section - Jak to działa */}
      <IntegrationsProcess />

      {/* CTA Section - Final call to action */}
      <IntegrationsCTA />
    </main>
  );
}
