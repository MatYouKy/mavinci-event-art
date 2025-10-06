import { Metadata } from 'next';
import { Dices, Spade, Club, Heart, CheckCircle2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Kasyno Eventowe | Mavinci',
  description: 'Profesjonalne kasyno eventowe na imprezy firmowe. Stoły do gier, krupierzy, żetony i pełna oprawa kasyna.',
  keywords: 'kasyno eventowe, kasyno firmowe, wieczór w kasynie, stoły do gier',
};

export default function KasynoPage() {
  const features = [
    'Profesjonalne stoły do gier',
    'Doświadczeni krupierzy',
    'Żetony i karty do gier',
    'Ruletka, blackjack, poker',
    'Dekoracje w stylu Las Vegas',
    'System punktacji i ranking',
    'Nagrody dla zwycięzców',
    'Pełna obsługa eventu',
  ];

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#0f1119]">
        <section className="relative py-24 md:py-32 bg-gradient-to-br from-[#1c1f33] to-[#0f1119] overflow-hidden">
          <div className="absolute inset-0">
            <img src="https://images.pexels.com/photos/262508/pexels-photo-262508.jpeg?auto=compress&cs=tinysrgb&w=1920" alt="Casino cards" className="w-full h-full object-cover opacity-20" />
            <div className="absolute inset-0 bg-gradient-to-br from-[#1c1f33]/90 to-[#0f1119]/90"></div>
          </div>

          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <Link href="/#uslugi" className="inline-flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors mb-8">
              <ArrowLeft className="w-4 h-4" />
              Powrót do usług
            </Link>

            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="inline-flex items-center gap-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-2 mb-6">
                  <Dices className="w-5 h-5 text-[#d3bb73]" />
                  <span className="text-[#d3bb73] text-sm font-medium">Wieczory w Kasynie</span>
                </div>

                <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6">
                  Kasyno <span className="text-[#d3bb73]">Eventowe</span>
                </h1>

                <p className="text-[#e5e4e2]/70 text-lg font-light leading-relaxed mb-8">
                  Przenieś swoich gości do świata Las Vegas! Profesjonalne kasyno eventowe z prawdziwymi stołami do gier, doświadczonymi krupierami i pełną oprawą wieczoru w stylu Monte Carlo.
                </p>

                <div className="flex flex-wrap gap-4">
                  <a href="/#kontakt" className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors">
                    Zapytaj o wycenę
                  </a>
                  <Link href="/#uslugi" className="inline-flex items-center gap-2 bg-[#d3bb73]/10 border border-[#d3bb73]/30 text-[#d3bb73] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/20 transition-colors">
                    Zobacz inne usługi
                  </Link>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 rounded-3xl blur-3xl"></div>
                <div className="relative bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/20 rounded-3xl p-8">
                  <Spade className="w-24 h-24 text-[#d3bb73] mb-6" />
                  <h3 className="text-2xl font-light text-[#e5e4e2] mb-4">Elegancja i Emocje</h3>
                  <p className="text-[#e5e4e2]/70 font-light">
                    Klimat prawdziwego kasyna, profesjonalni krupierzy i niezapomniana atmosfera gier hazardowych w bezpiecznym środowisku eventowym.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

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
            <Dices className="w-16 h-16 text-[#d3bb73] mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
              Zorganizujmy Wieczór w Kasynie!
            </h2>
            <p className="text-[#e5e4e2]/70 text-lg font-light mb-8 max-w-2xl mx-auto">
              Skontaktuj się z nami, aby przygotować niezapomniane kasyno eventowe. Zapewnimy profesjonalną obsługę i klimat prawdziwego Las Vegas.
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
