import React, { FC } from 'react';
import { FAQItem } from './FAQItems';

interface FAQSectionProps {
  faq: any[];
  setExpandedFaq: (idx: number | null) => void;
  expandedFaq: number | null;
}

export const FAQSection: FC<FAQSectionProps> = ({
  faq,
  setExpandedFaq,
  expandedFaq,
}) => {
  return (
    <section className="px-6">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-4xl font-light text-[#e5e4e2] mb-16 text-center">
          Najczęściej zadawane pytania
        </h2>

        <div className="space-y-4">
          {faq.map((item, idx) => (
            <FAQItem
              key={item.id}
              question={item.question}
              answer={item.answer}
              isExpanded={expandedFaq === idx}
              onToggle={() =>
                setExpandedFaq(expandedFaq === idx ? null : idx)
              }
            />
          ))}
        </div>
      </div>
    </section>
  );
};