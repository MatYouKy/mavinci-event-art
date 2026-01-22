import React, { FC } from 'react';
import { CheckCircle } from 'lucide-react';
import { ConferencesPricingEditor } from '@/components/ConferencesPricingEditor';

interface PricingSectionProps {
  isEditMode: boolean;
  pricing: any[];
  loadData: () => void;
  setIsContactFormOpen: (isOpen: boolean) => void;
}

export const PricingSection:FC<PricingSectionProps> = ({ isEditMode, pricing, loadData, setIsContactFormOpen }) => {
  return (
    <section className="py-20 px-6 bg-[#1c1f33]/30">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center">
              Orientacyjne ceny
            </h2>
            <p className="text-[#e5e4e2]/60 text-center mb-16">
              Ceny indywidualne dostosowane do specyfiki eventu
            </p>

            {isEditMode && (
              <ConferencesPricingEditor pricing={pricing} onUpdate={loadData} />
            )}

            <div className="grid md:grid-cols-3 gap-8">
              {pricing.map((tier) => (
                <div key={tier.id} className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-8 hover:border-[#d3bb73]/40 transition-all">
                  <div className="mb-6">
                    <h3 className="text-2xl font-medium text-[#d3bb73] mb-3">
                      {tier.tier_name}
                    </h3>
                    <p className="text-[#e5e4e2] text-3xl font-light mb-2">
                      {tier.price_range}
                    </p>
                    <p className="text-[#e5e4e2]/60 text-sm">
                      {tier.attendees_range}
                    </p>
                  </div>

                  <p className="text-[#e5e4e2]/80 mb-6 text-sm">
                    {tier.tier_description}
                  </p>

                  <div className="space-y-2 mb-6">
                    <h4 className="text-[#d3bb73] text-sm font-medium mb-3">Co zawiera:</h4>
                    {tier.whats_included.map((item: string, idx: number) => (
                      <div key={idx} className="flex items-start gap-2 text-[#e5e4e2]/70 text-sm">
                        <CheckCircle className="w-4 h-4 text-[#d3bb73] mt-0.5 flex-shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => setIsContactFormOpen(true)}
                    className="w-full py-3 rounded-lg font-medium transition-all bg-[#d3bb73]/10 text-[#d3bb73] border border-[#d3bb73]/30 hover:bg-[#d3bb73]/20"
                  >
                    Zapytaj o dokładną wycenę
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
  )
}
