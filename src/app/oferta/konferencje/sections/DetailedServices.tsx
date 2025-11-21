import ConferencesServicesAccordion from '@/components/ConferencesServicesAccordion';
import React, { FC } from 'react';

interface DetailedServicesProps {
  setIsContactFormOpen: (isOpen: boolean) => void;
}

export const DetailedServices: FC<DetailedServicesProps> = ({ setIsContactFormOpen }) => {
  return (
    <section className="bg-gradient-to-b from-[#0f1119] to-[#1c1f33] px-6 py-12 md:py-20">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-4xl font-light text-[#e5e4e2] md:text-5xl">
            Pełen Zakres <span className="text-[#d3bb73]">Usług Eventowych</span>
          </h2>
          <p className="mx-auto max-w-3xl text-lg text-[#e5e4e2]/60">
            Profesjonalna technika, doświadczony zespół i kompleksowa obsługa – od koncepcji po
            realizację
          </p>
        </div>

        <ConferencesServicesAccordion />

        <div className="mt-8 rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33]/50 w-full md:w-auto p-4 md:p-8 text-center md:mt-12">
          <h3 className="mb-4 text-2xl font-light text-[#e5e4e2]">
            Nie znalazłeś tego, czego szukasz?
          </h3>
          <p className="mx-auto mb-6 max-w-2xl text-balance text-[#e5e4e2]/60">
            Nasze możliwości wykraczają poza standardową ofertę. Skontaktuj się z nami, a znajdziemy
            idealne rozwiązanie dla Twojego wydarzenia.
          </p>
          <button
            onClick={() => setIsContactFormOpen(true)}
            className="inline-flex transform f items-center gap-2 rounded-full bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-all hover:scale-105 hover:bg-[#d3bb73]/90 md:px-8 md:py-3"
          >
            Zapytaj o swoją realizację
          </button>
        </div>
      </div>
    </section>
  );
};
