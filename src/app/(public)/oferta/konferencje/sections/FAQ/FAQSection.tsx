'use client';

import React, { FC, useState } from 'react';
import { FAQItem } from './FAQItems';

interface FAQSectionProps {
  faq: any[];
}

export const FAQSection: FC<FAQSectionProps> = ({
  faq,
}) => {
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  const handleToggle = (idx: number) => {
    setExpandedFaq(expandedFaq === idx ? null : idx);
  };
  return (
    <section className="px-2">
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
                handleToggle(idx)
              }
            />
          ))}
        </div>
      </div>
    </section>
  );
};