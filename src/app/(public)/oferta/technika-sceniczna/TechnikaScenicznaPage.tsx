'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase/browser';
import { useEditMode } from '@/contexts/EditModeContext';
import TechnicalStageFeatures from './sections/TechnicalStageFeatures';
import TechnicalStageServices from './sections/TechnicalStageServices';
import TechnicalStageGallery from './sections/TechnicalStageGallery';
import TechnicalStagePackages from './sections/TechnicalStagePackages';
import TechnicalStageCTA from './sections/TechnicalStageCTA';
import { RelatedServicesSection } from '../konferencje/sections/RelatedServicesSection';

export default function TechnikaScenicznaPage() {
  const { isEditMode } = useEditMode();
  const [relatedServices, setRelatedServices] = useState<any[]>([]);
  const [allServiceItems, setAllServiceItems] = useState<any[]>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());

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
        setSelectedServiceIds(new Set(relatedServicesRes.data.map((r) => r.service_item_id)));
      }
      if (allServiceItemsRes.data) setAllServiceItems(allServiceItemsRes.data);
    } catch (error) {
      console.error('Error fetching related services:', error);
    }
  };

  return (
    <main className="min-h-screen bg-[#0f1119]">
      <TechnicalStageFeatures />
      <TechnicalStageServices />
      <TechnicalStageGallery />
      <TechnicalStagePackages />
      <RelatedServicesSection
        isEditMode={isEditMode}
        selectedServiceIds={selectedServiceIds}
        setSelectedServiceIds={setSelectedServiceIds}
        allServiceItems={allServiceItems}
        loadData={loadData}
        relatedServices={relatedServices}
        tableName="technical_stage_related_services"
      />
      <TechnicalStageCTA />
    </main>
  );
}
