import React, { FC } from 'react'
import { ConferencesServicesEditor } from '@/components/ConferencesServicesEditor';
import { CheckCircle, Settings } from 'lucide-react';
import { iconMap } from '../ConferencesPage';

interface TechnicalServicesProps {
  services: any[];
  isEditMode: boolean;
  loadData: () => void;
}

export const TechnicalServices:FC<TechnicalServicesProps> = ({ services, isEditMode, loadData }) => {
  const getIcon = (iconName: string) => {
    const Icon = iconMap[iconName] || Settings;
    return Icon;
  };

  return (
    <section className="py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center">
              Zakres obsługi technicznej
            </h2>
            <p className="text-[#e5e4e2]/60 text-center mb-16">
              Kompleksowa realizacja audio-video dla Twojej konferencji
            </p>

            {isEditMode && (
              <ConferencesServicesEditor services={services} onUpdate={loadData} />
            )}

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {services.map((service) => {
                const Icon = getIcon(service.icon_name);
                return (
                  <div key={service.id} className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6">
                    <div className="w-14 h-14 bg-[#d3bb73] rounded-full flex items-center justify-center mb-4">
                      <Icon className="w-7 h-7 text-[#1c1f33]" />
                    </div>
                    <h3 className="text-2xl font-medium text-[#e5e4e2] mb-3">
                      {service.category_name}
                    </h3>
                    <p className="text-[#e5e4e2]/70 mb-4">
                      {service.category_description}
                    </p>
                    <ul className="space-y-2">
                      {service.services_list.map((item: string, idx: number) => (
                        <li key={idx} className="flex items-start gap-2 text-[#e5e4e2]/60 text-sm">
                          <CheckCircle className="w-4 h-4 text-[#d3bb73] mt-0.5 flex-shrink-0" />
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
  )
}
