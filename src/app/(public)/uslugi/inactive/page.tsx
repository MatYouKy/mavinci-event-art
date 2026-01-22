'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Lock, Search, Home, ArrowLeft } from 'lucide-react';

export default function InactiveServicePage() {
  const router = useRouter();
  const [countdown, setCountdown] = useState(8);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          router.push('/uslugi');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [router]);

  return (
    <div className="min-h-screen bg-[#0f1119] flex items-center justify-center px-6">
      <div className="max-w-2xl w-full text-center">
        {/* Icon */}
        <div className="mb-8 flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 bg-[#d3bb73]/20 blur-3xl rounded-full"></div>
            <div className="relative bg-[#1c1f33] border border-[#d3bb73]/20 rounded-full p-8">
              <Lock className="h-16 w-16 text-[#d3bb73]" strokeWidth={1.5} />
            </div>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-4xl md:text-5xl font-light text-[#e5e4e2] mb-4">
          Usługa <span className="text-[#d3bb73]">tymczasowo niedostępna</span>
        </h1>

        {/* Description */}
        <p className="text-lg text-[#e5e4e2]/70 mb-2 max-w-lg mx-auto">
          Ta usługa jest obecnie nieaktywna i niedostępna dla odwiedzających.
        </p>
        <p className="text-sm text-[#e5e4e2]/50 mb-8 max-w-lg mx-auto">
          Być może usługa jest w trakcie aktualizacji lub została przeniesiona. Zapraszamy do zapoznania się z naszą pełną ofertą.
        </p>

        {/* Countdown */}
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="h-1 flex-1 bg-[#1c1f33] rounded-full overflow-hidden max-w-xs">
            <div
              className="h-full bg-gradient-to-r from-[#d3bb73] to-[#b8a05e] transition-all duration-1000 ease-linear"
              style={{ width: `${(countdown / 8) * 100}%` }}
            ></div>
          </div>
          <span className="text-2xl font-medium text-[#d3bb73] min-w-[3ch]">
            {countdown}s
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap justify-center gap-4">
          <Link
            href="/uslugi"
            className="inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-4 text-lg font-medium text-[#1c1f33] shadow-lg transition-all hover:scale-105 hover:bg-[#d3bb73]/90"
          >
            <Search className="h-5 w-5" />
            Zobacz dostępne usługi
          </Link>

          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#1c1f33] px-8 py-4 text-lg font-medium text-[#e5e4e2] transition-all hover:border-[#d3bb73] hover:bg-[#1c1f33]/80"
          >
            <ArrowLeft className="h-5 w-5" />
            Wróć do poprzedniej
          </button>

          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#1c1f33] px-8 py-4 text-lg font-medium text-[#e5e4e2] transition-all hover:border-[#d3bb73] hover:bg-[#1c1f33]/80"
          >
            <Home className="h-5 w-5" />
            Strona główna
          </Link>
        </div>

        {/* Popular Categories */}
        <div className="mt-12 pt-8 border-t border-[#d3bb73]/10">
          <p className="text-sm text-[#e5e4e2]/50 mb-4">Popularne kategorie usług:</p>
          <div className="flex flex-wrap justify-center gap-2">
            {[
              { name: 'Konferencje', href: '/oferta/konferencje' },
              { name: 'Nagłośnienie', href: '/oferta/naglosnienie' },
              { name: 'Kasyno', href: '/oferta/kasyno' },
              { name: 'Streaming', href: '/oferta/streaming' },
              { name: 'VR', href: '/oferta/symulatory-vr' },
            ].map((service) => (
              <Link
                key={service.name}
                href={service.href}
                className="px-4 py-2 rounded-full text-sm border border-[#d3bb73]/20 text-[#e5e4e2]/70 hover:border-[#d3bb73]/40 hover:text-[#d3bb73] transition-colors"
              >
                {service.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
