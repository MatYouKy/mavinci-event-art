import ConferencesServicesAccordion from '@/components/ConferencesServicesAccordion';
import React, { FC } from 'react';

interface DetailedServicesProps {
  setIsContactFormOpen: (isOpen: boolean) => void;
}

export const DetailedServices:FC<DetailedServicesProps> = ({ setIsContactFormOpen }) => {
  return (
    <section className="py-20 px-6 bg-gradient-to-b from-[#0f1119] to-[#1c1f33]">
    <div className="max-w-7xl mx-auto">
      <div className="text-center mb-16">
        <h2 className="text-4xl md:text-5xl font-light text-[#e5e4e2] mb-4">
          Pełen Zakres <span className="text-[#d3bb73]">Usług Eventowych</span>
        </h2>
        <p className="text-[#e5e4e2]/60 text-lg max-w-3xl mx-auto">
          Profesjonalna technika, doświadczony zespół i kompleksowa obsługa – od koncepcji po realizację
        </p>
      </div>

      <ConferencesServicesAccordion />

      <div className="mt-12 text-center bg-[#1c1f33]/50 border border-[#d3bb73]/20 rounded-2xl p-8">
        <h3 className="text-2xl font-light text-[#e5e4e2] mb-4">
          Nie znalazłeś tego, czego szukasz?
        </h3>
        <p className="text-[#e5e4e2]/60 mb-6 max-w-2xl mx-auto">
          Nasze możliwości wykraczają poza standardową ofertę. Skontaktuj się z nami, a znajdziemy idealne rozwiązanie dla Twojego wydarzenia.
        </p>
        <button
          onClick={() => setIsContactFormOpen(true)}
          className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-all hover:scale-105 transform"
        >
          Zapytaj o niestandardową realizację
        </button>
      </div>
    </div>
  </section>
  )
}
