import { Metadata } from 'next';
import { Gamepad2, Trophy, Lightbulb, Users, CheckCircle2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { PageHeroImage } from '@/components/PageHeroImage';

export const metadata: Metadata = {
  title: 'Quizy i Teleturnieje | Mavinci',
  description: 'Interaktywne quizy i teleturnieje na eventy firmowe. Profesjonalna organizacja konkurów integracyjnych.',
  keywords: 'quizy, teleturnieje, quizy firmowe, konkursy integracyjne, gry zespołowe',
};

export default function QuizyTeleturniejePage() {
  const features = [
    'Autorskie scenariusze quizów',
    'Profesjonalny system do głosowania',
    'Interaktywne pulpity dla uczestników',
    'Ekrany LED z wynikami na żywo',
    'Nagrody i puchary dla zwycięzców',
    'Konferansjer prowadzący',
    'Muzyka i efekty dźwiękowe',
    'Personalizacja grafik i pytań',
  ];

  return (
    <>
      <main className="min-h-screen bg-[#0f1119]">
        <section className="py-24 bg-[#0f1119]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">Co Oferujemy</h2>
              <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {features.map((feature, index) => (
                <div key={index} className="flex items-start gap-3 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-all duration-300">
                  <CheckCircle2 className="w-5 h-5 text-[#d3bb73] flex-shrink-0 mt-0.5" />
                  <span className="text-[#e5e4e2]/90 font-light">{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-24 bg-gradient-to-br from-[#0f1119] to-[#1c1f33]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Gamepad2 className="w-16 h-16 text-[#d3bb73] mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
              Zorganizujmy Quiz na Twoim Evencie!
            </h2>
            <p className="text-[#e5e4e2]/70 text-lg font-light mb-8 max-w-2xl mx-auto">
              Skontaktuj się z nami, a przygotujemy interaktywny quiz dostosowany do charakteru Twojego wydarzenia i grupy uczestników.
            </p>
            <a href="/#kontakt" className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors">
              Skontaktuj się z nami
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
