import React, { FC } from 'react';
import { ChevronDown } from 'lucide-react';

interface FAQSectionProps {
  faq: any[];
  setExpandedFaq: (idx: number | null) => void;
  expandedFaq: number | null;
}

export const FAQSection:FC<FAQSectionProps> = ({ faq, setExpandedFaq, expandedFaq }) => {
  return (
    <section className=" px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-16 text-center">
              Najczęściej zadawane pytania
            </h2>

            <div className="space-y-4">
              {faq.map((item, idx) => (
                <div key={item.id} className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedFaq(expandedFaq === idx ? null : idx)}
                    className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-[#d3bb73]/5 transition-colors"
                  >
                    <span className="text-lg text-[#e5e4e2] font-medium pr-4">
                      {item.question}
                    </span>
                    <ChevronDown className={`w-5 h-5 text-[#d3bb73] transition-transform flex-shrink-0 ${expandedFaq === idx ? 'rotate-180' : ''}`} />
                  </button>
                  {expandedFaq === idx && (
                    <div className="px-6 pb-4 text-[#e5e4e2]/70">
                      {item.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
  )
}
