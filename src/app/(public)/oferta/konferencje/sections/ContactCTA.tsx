import React, { FC } from 'react';
import { Mail } from 'lucide-react';

interface ContactCTAProps {
  setIsContactFormOpen: (isOpen: boolean) => void;
}

export const ContactCTA: FC<ContactCTAProps> = ({ setIsContactFormOpen }) => {
  return (
    <section className="py-12 px-4 sm:py-20 sm:px-6 bg-gradient-to-br from-[#1c1f33] to-[#0f1119]">
      <div className="max-w-4xl mx-auto text-center">
        
        {/* Ikona */}
        <div className="w-14 h-14 sm:w-20 sm:h-20 bg-[#d3bb73] rounded-full flex items-center justify-center mx-auto mb-5 sm:mb-6">
          <Mail className="w-7 h-7 sm:w-10 sm:h-10 text-[#1c1f33]" />
        </div>

        {/* Tytuł */}
        <h2 className="text-2xl sm:text-4xl font-light text-[#e5e4e2] mb-3 sm:mb-4 px-4">
          Porozmawiajmy o Twojej konferencji
        </h2>

        {/* Podtytuł */}
        <p className="text-lg sm:text-xl text-[#e5e4e2]/70 mb-6 sm:mb-8">
          Odpowiadamy w ciągu 24 godzin
        </p>

        {/* Przycisk */}
        <button
          onClick={() => setIsContactFormOpen(true)}
          className="
            px-6 py-3 sm:px-10 sm:py-4
            bg-[#d3bb73]
            text-[#1c1f33]
            font-medium
            rounded-lg
            hover:bg-[#c5ad65]
            transition-all
            text-base sm:text-lg
          "
        >
          Wyceń swoją konferencję
        </button>
      </div>
    </section>
  );
};