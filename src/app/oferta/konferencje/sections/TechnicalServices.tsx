import React, { FC } from 'react';
import { ConferencesServicesEditor } from '@/components/ConferencesServicesEditor';
import { CheckCircle, Settings } from 'lucide-react';
import { iconMap } from '../ConferencesPage';

interface TechnicalServicesProps {
  services: any[];
  isEditMode: boolean;
  loadData: () => void;
}

export const TechnicalServices: FC<TechnicalServicesProps> = ({
  services,
  isEditMode,
  loadData,
}) => {
  const getIcon = (iconName: string) => {
    const Icon = iconMap[iconName] || Settings;
    return Icon;
  };

  return (
    <section className="py-12 px-4 sm:px-6 lg:py-20">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-light text-[#e5e4e2] mb-3 sm:mb-4 text-center">
          Zakres obsługi technicznej
        </h2>
        <p className="text-[#e5e4e2]/60 text-center mb-10 sm:mb-16 text-sm sm:text-base">
          Kompleksowa realizacja audio-video dla Twojej konferencji
        </p>

        {isEditMode && (
          <div className="mb-10">
            <ConferencesServicesEditor services={services} onUpdate={loadData} />
          </div>
        )}

        <div className="grid gap-6 sm:gap-8 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => {
            const Icon = getIcon(service.icon_name);
            return (
              <div
                key={service.id}
                className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-4 sm:p-6 flex flex-col h-full"
              >
                <div className="w-12 h-12 sm:w-14 sm:h-14 bg-[#d3bb73] rounded-full flex items-center justify-center mb-3 sm:mb-4 mx-auto sm:mx-0">
                  <Icon className="w-6 h-6 sm:w-7 sm:h-7 text-[#1c1f33]" />
                </div>
                <h3 className="text-xl sm:text-2xl font-medium text-[#e5e4e2] mb-2 sm:mb-3 text-center sm:text-left">
                  {service.category_name}
                </h3>
                <p className="text-[#e5e4e2]/70 mb-3 sm:mb-4 text-sm sm:text-base text-center sm:text-left">
                  {service.category_description}
                </p>
                <ul className="space-y-1.5 sm:space-y-2 mt-auto">
                  {service.services_list.map((item: string, idx: number) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2 text-[#e5e4e2]/60 text-xs sm:text-sm"
                    >
                      <CheckCircle className="w-3 h-3 sm:w-4 sm:h-4 text-[#d3bb73] mt-0.5 flex-shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};