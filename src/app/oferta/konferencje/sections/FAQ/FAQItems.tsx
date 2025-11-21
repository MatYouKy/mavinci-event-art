import React, { FC } from 'react';
import { ChevronDown } from 'lucide-react';
import { useMobile } from '@/hooks/useMobile';

interface FAQItemProps {
  question: string;
  answer: string;
  isExpanded: boolean;
  onToggle: () => void;
}

export const FAQItem: FC<FAQItemProps> = ({
  question,
  answer,
  isExpanded,
  onToggle,
}) => {
  const isMobile = useMobile();

  return (
    <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className={`
          w-full flex items-center justify-between text-left transition-colors
          hover:bg-[#d3bb73]/5 
          ${isMobile ? 'px-4 py-3' : 'px-6 py-4'}
        `}
      >
        <span
          className={`
            font-medium pr-4 text-[#e5e4e2]
            ${isMobile ? 'text-base' : 'text-lg'}
          `}
        >
          {question}
        </span>

        <ChevronDown
          className={`
            flex-shrink-0 text-[#d3bb73] transition-transform
            ${isMobile ? 'w-4 h-4' : 'w-5 h-5'}
            ${isExpanded ? 'rotate-180' : ''}
          `}
        />
      </button>

      {isExpanded && (
        <div
          className={`
            text-[#e5e4e2]/70
            ${isMobile ? 'px-4 pb-3 text-sm' : 'px-6 pb-4 text-base'}
          `}
        >
          {answer}
        </div>
      )}
    </div>
  );
};