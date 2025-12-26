'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Dices, CircleDot, CheckCircle } from 'lucide-react';
import Link from 'next/link';
import Footer from '@/components/Footer';
import { supabase } from '@/lib/supabase';

export default function RouletteRulesPage() {
  const [rules, setRules] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    const { data } = await supabase
      .from('casino_game_rules')
      .select('*')
      .eq('slug', 'ruletka')
      .single();

    if (data) setRules(data);
    setLoading(false);
  };

  if (loading) {
    return (
      <>
        <main className="min-h-screen bg-[#0f1119] flex items-center justify-center">
          <div className="text-[#d3bb73] text-lg">Ładowanie...</div>
        </main>
      </>
    );
  }

  return (
    <>

      <main className="min-h-screen bg-[#0f1119]">
        <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <Link
            href="/oferta/kasyno"
            className="inline-flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Powrót do Kasyna Eventowego
          </Link>

          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-light text-[#e5e4e2] mb-4">
              {rules?.game_name || 'Ruletka'}
            </h1>
            <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto mb-6"></div>
            <p className="text-[#e5e4e2]/70 text-lg font-light">
              {rules?.short_description || 'Poznaj zasady gry w ruletkę'}
            </p>
          </div>

          <div className="space-y-8">
            {parseRulesContent(rules?.rules_content).map((section, idx) => (
              <div
                key={idx}
                className="bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/20 rounded-2xl p-8 md:p-12 hover:border-[#d3bb73]/40 transition-all duration-300"
              >
                {section.title && (
                  <h2 className="text-3xl font-light text-[#e5e4e2] mb-6 flex items-center gap-3">
                    <CircleDot className="w-6 h-6 text-[#d3bb73]" />
                    {section.title}
                  </h2>
                )}

                {section.content && (
                  <p className="text-[#e5e4e2]/80 font-light leading-relaxed mb-6 text-lg">
                    {section.content}
                  </p>
                )}

                {section.subsections && section.subsections.length > 0 && (
                  <div className="space-y-6">
                    {section.subsections.map((sub, subIdx) => (
                      <div key={subIdx} className="pl-6 border-l-2 border-[#d3bb73]/30">
                        <h3 className="text-xl font-light text-[#d3bb73] mb-4">
                          {sub.title}
                        </h3>
                        {sub.items && sub.items.length > 0 && (
                          <ul className="space-y-3">
                            {sub.items.map((item, itemIdx) => (
                              <li key={itemIdx} className="flex items-start gap-3 text-[#e5e4e2]/80">
                                <CheckCircle className="w-5 h-5 text-[#d3bb73] flex-shrink-0 mt-0.5" />
                                <span className="font-light leading-relaxed">{item}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {section.items && section.items.length > 0 && (
                  <ul className="space-y-3">
                    {section.items.map((item, itemIdx) => (
                      <li key={itemIdx} className="flex items-start gap-3 text-[#e5e4e2]/80">
                        <CheckCircle className="w-5 h-5 text-[#d3bb73] flex-shrink-0 mt-0.5" />
                        <span className="font-light leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <div className="mt-12 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-xl p-6 text-center">
            <Dices className="w-12 h-12 text-[#d3bb73] mx-auto mb-4" />
            <h2 className="text-2xl font-light text-[#e5e4e2] mb-3">
              Chcesz zorganizować kasyno eventowe?
            </h2>
            <p className="text-[#e5e4e2]/70 font-light mb-6">
              Skontaktuj się z nami aby otrzymać ofertę na profesjonalne kasyno eventowe z ruletką
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <a
                href="/#kontakt"
                className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
              >
                Zapytaj o wycenę
              </a>
              <Link
                href="/oferta/kasyno"
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

function parseRulesContent(content: string) {
  if (!content) return [];

  const sections: any[] = [];
  const lines = content.split('\n');
  let currentSection: any = null;
  let currentSubsection: any = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('## ')) {
      if (currentSection) sections.push(currentSection);
      currentSection = { title: line.replace('## ', ''), subsections: [], items: [] };
      currentSubsection = null;
    } else if (line.startsWith('### ')) {
      if (currentSubsection) currentSection?.subsections.push(currentSubsection);
      currentSubsection = { title: line.replace('### ', ''), items: [] };
    } else if (line.startsWith('- ')) {
      const item = line.replace(/^- \*\*(.+?)\*\* - /, '$1: ').replace(/^- /, '');
      if (currentSubsection) {
        currentSubsection.items.push(item);
      } else if (currentSection) {
        currentSection.items.push(item);
      }
    } else if (line && !line.startsWith('#') && !line.startsWith('**')) {
      if (!currentSection?.content) {
        if (currentSection) currentSection.content = line;
      }
    }
  }

  if (currentSubsection) currentSection?.subsections.push(currentSubsection);
  if (currentSection) sections.push(currentSection);

  return sections;
}
