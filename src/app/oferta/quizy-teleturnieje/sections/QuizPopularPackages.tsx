'use client';

import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Edit2, Plus, Package } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useWebsiteEdit } from '@/hooks/useWebsiteEdit';
import { CustomIcon } from '@/components/UI/CustomIcon/CustomIcon';
import QuizPackageEditModal from './QuizPackageEditModal';
import { RelatedServicesSection } from '../../konferencje/sections/RelatedServicesSection';
import { useEditMode } from '@/contexts/EditModeContext';

interface PopularPackage {
  id: string;
  title: string;
  description: string;
  image_url: string | null;
  icon_id: string | null;
  order_index: number;
}

export default function QuizPopularPackages() {
  const { isEditMode } = useEditMode();
  const { canEdit } = useWebsiteEdit();
  const [packages, setPackages] = useState<PopularPackage[]>([]);
  const [relatedServices, setRelatedServices] = useState<any[]>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());
  const [allServiceItems, setAllServiceItems] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // useEffect(() => {
  //   fetchPackages();

  //   const channel = supabase
  //     .channel('quiz_packages_changes')
  //     .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_popular_packages' }, (payload) => {
  //       if (payload.eventType === 'INSERT') {
  //         setPackages(prev => [...prev, payload.new as PopularPackage].sort((a, b) => a.order_index - b.order_index));
  //       } else if (payload.eventType === 'UPDATE') {
  //         setPackages(prev => prev.map(p => p.id === payload.new.id ? payload.new as PopularPackage : p));
  //       } else if (payload.eventType === 'DELETE') {
  //         setPackages(prev => prev.filter(p => p.id !== payload.old.id));
  //       }
  //     })
  //     .subscribe();

  //   return () => {
  //     supabase.removeChannel(channel);
  //   };
  // }, []);

  const fetchPackages = async () => {
    try {
      const { data, error } = await supabase
        .from('quiz_popular_packages')
        .select('*')
        .eq('is_visible', true)
        .order('order_index', { ascending: true });

      if (error) throw error;
      setPackages(data || []);
    } catch (error) {
      console.error('Error fetching packages:', error);
    }
  };

  if (packages.length === 0 && !canEdit) return null;



  const fetchData = async () => {
    try {
      const [
        relatedServicesRes,
        allServiceItemsRes,
      ] = await Promise.all([
        supabase
          .from('quiz_related_services')
          .select(`*, service_item:conferences_service_items(*)`)
          .eq('is_active', true)
          .order('display_order'),
        supabase.from('conferences_service_items').select('*').eq('is_active', true).order('display_order'),
      ]);

      console.log('Quiz Page data loaded:', {
        relatedServicesCount: relatedServicesRes.data?.length,
        allServiceItemsCount: allServiceItemsRes.data?.length,
      });

      if (relatedServicesRes.error) console.error('quiz_related_services error:', relatedServicesRes.error);


      if (relatedServicesRes.data) {
        setRelatedServices(relatedServicesRes.data.map((r) => r.service_item));
        setSelectedServiceIds(new Set(relatedServicesRes.data.map((r) => r.service_item_id)));
      }
      if (allServiceItemsRes.data) setAllServiceItems(allServiceItemsRes.data);
    } catch (error) {
      console.error('Error fetching Quiz data:', error);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);


  return (
    <>
      <RelatedServicesSection
        isEditMode={isEditMode}
        selectedServiceIds={selectedServiceIds}
        setSelectedServiceIds={setSelectedServiceIds}
        allServiceItems={allServiceItems}
        loadData={fetchData}
        relatedServices={relatedServices}
        tableName="quiz_related_services"
      />

      {(editingId || isAdding) && (
        <QuizPackageEditModal
          packageId={editingId}
          onClose={() => {
            setEditingId(null);
            setIsAdding(false);
          }}
        />
      )}
    </>
  );
}
