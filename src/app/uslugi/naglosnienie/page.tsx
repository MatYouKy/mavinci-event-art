import { Metadata } from 'next';
import { Music, Volume2, Radio, Zap, CheckCircle2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Nagłośnienie Eventów | Mavinci',
  description: 'Profesjonalne systemy nagłośnieniowe na eventy, koncerty i imprezy. Sprzęt najwyższej klasy z obsługą techniczną.',
  keywords: 'nagłośnienie, systemy audio, sprzęt nagłaśniający, obsługa dźwięku, eventy',
};

export default function NaglosnieniaPage() {
  const features = [
    'Systemy line array najwyższej klasy',
    'Monitory sceniczne i odsłuchy',
    'Mikrofony bezprzewodowe i przewodowe',
    'Miksery cyfrowe z pełną kontrolą',
    'Procesory audio i equalizery',
    'Profesjonalna obsługa techniczna',
    'Konfiguracja dostosowana do miejsca',
    'Pomiary akustyczne i optymalizacja',
  ];

  const applications = [
    { title: 'Koncerty', desc: 'Nagłośnienie scen koncertowych od 100 do 10000 osób' },
    { title: 'Konferencje', desc: 'Wyraźny dźwięk dla prezentacji i wykładów' },
    { title: 'Eventy Plenerowe', desc: 'Systemy odporne na warunki atmosferyczne' },
    { title: 'Imprezy Firmowe', desc: 'Dyskretne nagłośnienie dla biznesu' },
  ];

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#0f1119]">
      {/* Hero Section */}
      <section className="relative py-24 md:py-32 bg-gradient-to-br from-[#1c1f33] to-[#0f1119] overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=1920"
            alt="Professional audio equipment"
            className="w-full h-full object-cover opacity-20"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-[#1c1f33]/90 to-[#0f1119]/90"></div>
        </div>
        <div className="absolute inset-0 opacity-10">
          <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="hero-dots" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1" fill="#d3bb73" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#hero-dots)" />
          </svg>
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href="/#uslugi"
            className="inline-flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Powrót do usług
          </Link>

          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-2 mb-6">
                <Music className="w-5 h-5 text-[#d3bb73]" />
                <span className="text-[#d3bb73] text-sm font-medium">Profesjonalne Nagłośnienie</span>
              </div>

              <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6">
                Nagłośnienie <span className="text-[#d3bb73]">Eventów</span>
              </h1>

              <p className="text-[#e5e4e2]/70 text-lg font-light leading-relaxed mb-8">
                Dostarczamy profesjonalne systemy nagłośnieniowe najwyższej klasy. Nasz sprzęt i doświadczony zespół techniczny gwarantują krystalicznie czysty dźwięk na każdym evencie.
              </p>

              <div className="flex flex-wrap gap-4">
                <a
                  href="/#kontakt"
                  className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
                >
                  Zapytaj o wycenę
                </a>
                <Link
                  href="/#uslugi"
                  className="inline-flex items-center gap-2 bg-[#d3bb73]/10 border border-[#d3bb73]/30 text-[#d3bb73] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/20 transition-colors"
                >
                  Zobacz inne usługi
                </Link>
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 rounded-3xl blur-3xl"></div>
              <div className="relative bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/20 rounded-3xl p-8">
                <Volume2 className="w-24 h-24 text-[#d3bb73] mb-6" />
                <h3 className="text-2xl font-light text-[#e5e4e2] mb-4">Sprzęt Najwyższej Klasy</h3>
                <p className="text-[#e5e4e2]/70 font-light">
                  Wykorzystujemy systemy audio renomowanych marek, zapewniając doskonałą jakość dźwięku dla każdego typu wydarzenia.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 bg-[#0f1119]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">
              Co Oferujemy
            </h2>
            <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, index) => (
              <div
                key={index}
                className="flex items-start gap-3 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-all duration-300"
              >
                <CheckCircle2 className="w-5 h-5 text-[#d3bb73] flex-shrink-0 mt-0.5" />
                <span className="text-[#e5e4e2]/90 font-light">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Applications Section */}
      <section className="py-24 bg-[#1c1f33]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">
              Zastosowania
            </h2>
            <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {applications.map((app, index) => (
              <div
                key={index}
                className="group relative bg-gradient-to-br from-[#0f1119]/80 to-[#0f1119]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-2xl p-8 hover:border-[#d3bb73]/30 transition-all duration-300 hover:transform hover:-translate-y-2"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl"></div>

                <div className="relative z-10">
                  <Zap className="w-8 h-8 text-[#d3bb73] mb-4" />
                  <h3 className="text-xl font-light text-[#e5e4e2] mb-3">{app.title}</h3>
                  <p className="text-[#e5e4e2]/60 text-sm font-light">{app.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-gradient-to-br from-[#0f1119] to-[#1c1f33]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Radio className="w-16 h-16 text-[#d3bb73] mx-auto mb-6" />
          <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
            Potrzebujesz Profesjonalnego Nagłośnienia?
          </h2>
          <p className="text-[#e5e4e2]/70 text-lg font-light mb-8 max-w-2xl mx-auto">
            Skontaktuj się z nami, aby omówić szczegóły Twojego eventu. Dobierzemy optymalne rozwiązanie audio dla Twojego wydarzenia.
          </p>
          <a
            href="/#kontakt"
            className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
          >
            Skontaktuj się z nami
          </a>
        </div>
      </section>
      </main>
      <Footer />
    </>
  );
}
