'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Dices, CircleDot, CheckCircle } from 'lucide-react';
import Link from 'next/link';
import Footer from '@/components/Footer';
import { supabase } from '@/lib/supabase/browser';

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
        <main className="flex min-h-screen items-center justify-center bg-[#0f1119]">
          <div className="text-lg text-[#d3bb73]">Ładowanie...</div>
        </main>
      </>
    );
  }

  return (
    <>
      <main className="min-h-screen bg-[#0f1119]">
        <article className="mx-auto max-w-4xl px-4 py-24 sm:px-6 lg:px-8">
          <Link
            href="/oferta/kasyno"
            className="mb-8 inline-flex items-center gap-2 text-[#d3bb73] transition-colors hover:text-[#d3bb73]/80"
          >
            <ArrowLeft className="h-4 w-4" />
            Powrót do Kasyna Eventowego
          </Link>

          <div className="mb-12 text-center">
            <h1 className="mb-4 text-4xl font-light text-[#e5e4e2] md:text-5xl">
              {rules?.game_name || 'Ruletka'}
            </h1>
            <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
            <p className="text-lg font-light text-[#e5e4e2]/70">
              {rules?.short_description || 'Poznaj zasady gry w ruletkę'}
            </p>
          </div>

          <div className="space-y-8">
            {parseRulesContent(rules?.rules_content).map((section, idx) => (
              <div
                key={idx}
                className="rounded-2xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 p-8 backdrop-blur-sm transition-all duration-300 hover:border-[#d3bb73]/40 md:p-12"
              >
                {section.title && (
                  <h2 className="mb-6 flex items-center gap-3 text-3xl font-light text-[#e5e4e2]">
                    <CircleDot className="h-6 w-6 text-[#d3bb73]" />
                    {section.title}
                  </h2>
                )}

                {section.content && (
                  <p className="mb-6 text-lg font-light leading-relaxed text-[#e5e4e2]/80">
                    {section.content}
                  </p>
                )}

                {section.subsections && section.subsections.length > 0 && (
                  <div className="space-y-6">
                    {section.subsections.map((sub, subIdx) => (
                      <div key={subIdx} className="border-l-2 border-[#d3bb73]/30 pl-6">
                        <h3 className="mb-4 text-xl font-light text-[#d3bb73]">{sub.title}</h3>
                        {sub.items && sub.items.length > 0 && (
                          <ul className="space-y-3">
                            {sub.items.map((item, itemIdx) => (
                              <li
                                key={itemIdx}
                                className="flex items-start gap-3 text-[#e5e4e2]/80"
                              >
                                <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#d3bb73]" />
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
                        <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#d3bb73]" />
                        <span className="font-light leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <div className="mt-12 rounded-xl border border-[#d3bb73]/30 bg-[#d3bb73]/10 p-6 text-center">
            <Dices className="mx-auto mb-4 h-12 w-12 text-[#d3bb73]" />
            <h2 className="mb-3 text-2xl font-light text-[#e5e4e2]">
              Chcesz zorganizować kasyno eventowe?
            </h2>
            <p className="mb-6 font-light text-[#e5e4e2]/70">
              Skontaktuj się z nami aby otrzymać ofertę na profesjonalne kasyno eventowe z ruletką
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <a
                href="/#kontakt"
                className="inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-3 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
              >
                Zapytaj o wycenę
              </a>
              <Link
                href="/oferta/kasyno"
                className="inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-8 py-3 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
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
