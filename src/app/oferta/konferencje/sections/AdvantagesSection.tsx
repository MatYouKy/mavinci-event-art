import React, { FC } from 'react'
import { Package } from 'lucide-react';
import { iconMap } from '../ConferencesPage';

interface AdvantagesSectionProps {
  advantages: any[];
}

export const AdvantagesSection:FC<AdvantagesSectionProps> = ({ advantages }) => {
  const getIcon = (iconName: string) => {
    const Icon = iconMap[iconName] || Package;
    return Icon;
  };
  return (
    <section className="py-20 px-6 bg-[#1c1f33]/30">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-16 text-center">
              Dlaczego MAVINCI?
            </h2>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {advantages.map((adv) => {
                const Icon = getIcon(adv.icon_name);
                return (
                  <div key={adv.id} className="flex gap-4">
                    <div className="w-12 h-12 bg-[#d3bb73] rounded-full flex items-center justify-center flex-shrink-0">
                      <Icon className="w-6 h-6 text-[#1c1f33]" />
                    </div>
                    <div>
                      <h3 className="text-xl font-medium text-[#e5e4e2] mb-2">
                        {adv.title}
                      </h3>
                      <p className="text-[#e5e4e2]/70 text-sm">
                        {adv.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
  )
}
