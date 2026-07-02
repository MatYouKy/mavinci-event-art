'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useEditMode } from '@/contexts/EditModeContext';
import TechnicalStageFeatures from './sections/TechnicalStageFeatures';
import TechnicalStageServices from './sections/TechnicalStageServices';
import TechnicalStageGallery from './sections/TechnicalStageGallery';
import TechnicalStagePackages from './sections/TechnicalStagePackages';
import TechnicalStageCTA from './sections/TechnicalStageCTA';
import { RelatedServicesSection } from '../konferencje/sections/RelatedServicesSection';
import TechStageCityProcess from './[miasto]/TechStageCityProcess';
import TechStageCityBenefits from './[miasto]/TechStageCityBenefits';

export default function TechnikaScenicznaPage() {
  const { isEditMode } = useEditMode();
  const [relatedServices, setRelatedServices] = useState<any[]>([]);
  const [allServiceItems, setAllServiceItems] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [relatedServicesRes, allServiceItemsRes] = await Promise.all([
        supabase
          .from('technical_stage_related_services')
          .select(`*, service_item:conferences_service_items(*)`)
          .eq('is_active', true)
          .order('display_order'),
        supabase
          .from('conferences_service_items')
          .select('*')
          .eq('is_active', true)
          .order('display_order'),
      ]);

      if (relatedServicesRes.data) {
        setRelatedServices(relatedServicesRes.data.map((r) => r.service_item));
      }
      if (allServiceItemsRes.data) setAllServiceItems(allServiceItemsRes.data);
    } catch (error) {
      console.error('Error fetching related services:', error);
    }
  };

  return (
    <main className="min-h-screen bg-[#0f1119]">
      <TechnicalStageFeatures />
      {/* <TechnicalStageServices /> */}
      <TechStageCityBenefits />
      <TechStageCityProcess />
      <TechnicalStageGallery />
      <TechnicalStagePackages />
      <RelatedServicesSection
        isEditMode={isEditMode}
        allServiceItems={allServiceItems}
        relatedServices={relatedServices}
        tableName="technical_stage_related_services"
      />
      <TechnicalStageCTA />
    </main>
  );
}
