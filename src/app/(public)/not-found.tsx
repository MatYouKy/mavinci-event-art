'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Head from 'next/head';
import { AlertCircle, Home, ArrowLeft, Search } from 'lucide-react';

export default function NotFound() {
  const router = useRouter();
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          router.push('/');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [router]);

  return (
    <>
      <Head>
        <title>404 - Strona nie została znaleziona | MAVINCI Event & ART</title>
      </Head>
      <div className="min-h-screen bg-[#0f1119] flex items-center justify-center px-6">
        <div className="max-w-2xl w-full text-center">
        {/* 404 Number */}
        <div className="mb-8">
          <div className="relative inline-block">
            <div className="absolute inset-0 bg-[#d3bb73]/10 blur-3xl"></div>
            <h2 className="relative text-9xl font-bold text-transparent bg-clip-text bg-gradient-to-br from-[#d3bb73] to-[#b8a05e] opacity-50">
              404
            </h2>
          </div>
        </div>

        {/* Icon */}
        <div className="mb-6 flex justify-center">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-full p-6">
            <AlertCircle className="h-12 w-12 text-[#d3bb73]" strokeWidth={1.5} />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-4xl md:text-5xl font-light text-[#e5e4e2] mb-4">
          Strona <span className="text-[#d3bb73]">nie istnieje</span>
        </h1>

        {/* Description */}
        <p className="text-lg text-[#e5e4e2]/70 mb-8 max-w-lg mx-auto">
          Przepraszamy, ale strona którą szukasz nie została znaleziona. Mogła zostać przeniesiona lub usunięta.
        </p>

        {/* Countdown */}
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="h-1 flex-1 bg-[#1c1f33] rounded-full overflow-hidden max-w-xs">
            <div
              className="h-full bg-gradient-to-r from-[#d3bb73] to-[#b8a05e] transition-all duration-1000 ease-linear"
              style={{ width: `${(countdown / 10) * 100}%` }}
            ></div>
          </div>
          <span className="text-2xl font-medium text-[#d3bb73] min-w-[3ch]">
            {countdown}s
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap justify-center gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-4 text-lg font-medium text-[#1c1f33] shadow-lg transition-all hover:scale-105 hover:bg-[#d3bb73]/90"
          >
            <Home className="h-5 w-5" />
            Strona główna
          </Link>

          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#1c1f33] px-8 py-4 text-lg font-medium text-[#e5e4e2] transition-all hover:border-[#d3bb73] hover:bg-[#1c1f33]/80"
          >
            <ArrowLeft className="h-5 w-5" />
            Wróć do poprzedniej
          </button>

          <Link
            href="/uslugi"
            className="inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#1c1f33] px-8 py-4 text-lg font-medium text-[#e5e4e2] transition-all hover:border-[#d3bb73] hover:bg-[#1c1f33]/80"
          >
            <Search className="h-5 w-5" />
            Nasze usługi
          </Link>
        </div>

        {/* Quick Links */}
        <div className="mt-12 pt-8 border-t border-[#d3bb73]/10">
          <p className="text-sm text-[#e5e4e2]/50 mb-4">Popularne sekcje:</p>
          <div className="flex flex-wrap justify-center gap-2">
            {[
              { name: 'Oferta', href: '/oferta' },
              { name: 'Portfolio', href: '/portfolio' },
              { name: 'O nas', href: '/o-nas' },
              { name: 'Zespół', href: '/zespol' },
              { name: 'Kontakt', href: '/#kontakt' },
            ].map((link) => (
              <Link
                key={link.name}
                href={link.href}
                className="px-4 py-2 rounded-full text-sm border border-[#d3bb73]/20 text-[#e5e4e2]/70 hover:border-[#d3bb73]/40 hover:text-[#d3bb73] transition-colors"
              >
                {link.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
