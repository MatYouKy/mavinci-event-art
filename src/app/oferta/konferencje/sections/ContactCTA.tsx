import React, { FC } from 'react';
import { Mail } from 'lucide-react';

interface ContactCTAProps {
  setIsContactFormOpen: (isOpen: boolean) => void;
}

export const ContactCTA:FC<ContactCTAProps> = ({ setIsContactFormOpen }) => {
  return (
    <section className="py-20 px-6 bg-gradient-to-br from-[#1c1f33] to-[#0f1119]">
    <div className="max-w-4xl mx-auto text-center">
      <div className="w-20 h-20 bg-[#d3bb73] rounded-full flex items-center justify-center mx-auto mb-6">
        <Mail className="w-10 h-10 text-[#1c1f33]" />
      </div>
      <h2 className="text-4xl font-light text-[#e5e4e2] mb-4">
        Porozmawiajmy o Twojej konferencji
      </h2>
      <p className="text-xl text-[#e5e4e2]/70 mb-8">
        Odpowiadamy w ciągu 24 godzin
      </p>
      <button
        onClick={() => setIsContactFormOpen(true)}
        className="px-10 py-4 bg-[#d3bb73] text-[#1c1f33] font-medium rounded-lg hover:bg-[#c5ad65] transition-all text-lg"
      >
        Wyceń swoją konferencję
      </button>
    </div>
  </section>
  )
}
