'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Dices } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { supabase } from '@/lib/supabase';

export default function PokerRulesPage() {
  const [rules, setRules] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    const { data } = await supabase
      .from('casino_game_rules')
      .select('*')
      .eq('slug', 'poker-texas-holdem')
      .single();

    if (data) setRules(data);
    setLoading(false);
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <main className="min-h-screen bg-[#0f1119] flex items-center justify-center">
          <div className="text-[#d3bb73] text-lg">Ładowanie...</div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#0f1119]">
        <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <Link
            href="/uslugi/kasyno"
            className="inline-flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Powrót do Kasyna Eventowego
          </Link>

          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-light text-[#e5e4e2] mb-4">
              {rules?.game_name || 'Poker Texas Hold\'em'}
            </h1>
            <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto mb-6"></div>
            <p className="text-[#e5e4e2]/70 text-lg font-light">
              {rules?.short_description || 'Poznaj zasady gry w pokera Texas Hold\'em'}
            </p>
          </div>

          <div className="bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/20 rounded-2xl p-8 md:p-12">
            <div className="prose prose-invert prose-lg max-w-none">
              <div className="text-[#e5e4e2]/90 font-light leading-relaxed whitespace-pre-line">
                {rules?.rules_content}
              </div>
            </div>
          </div>

          <div className="mt-12 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-xl p-6 text-center">
            <Dices className="w-12 h-12 text-[#d3bb73] mx-auto mb-4" />
            <h2 className="text-2xl font-light text-[#e5e4e2] mb-3">
              Chcesz zorganizować kasyno eventowe?
            </h2>
            <p className="text-[#e5e4e2]/70 font-light mb-6">
              Skontaktuj się z nami aby otrzymać ofertę na profesjonalne kasyno eventowe z poker'em Texas Hold'em
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <a
                href="/#kontakt"
                className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
              >
                Zapytaj o wycenę
              </a>
              <Link
                href="/uslugi/kasyno"
                className="inline-flex items-center gap-2 bg-[#d3bb73]/10 border border-[#d3bb73]/30 text-[#d3bb73] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/20 transition-colors"
              >
                Wróć do Kasyna
              </Link>
            </div>
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
