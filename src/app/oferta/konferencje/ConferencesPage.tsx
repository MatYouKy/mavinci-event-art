'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Mic, Camera, Lightbulb, Monitor, Wifi, Settings,
  Award, Shield, Users, Video, FileSearch, MapPin,
  MessageSquare, Search, FileText, CheckCircle, Play, Package,
  Presentation, Music,
} from 'lucide-react';

import ContactFormWithTracking from '@/components/ContactFormWithTracking';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';

import { DetailedServices } from './sections/DetailedServices';
import { GallerySection } from './sections/GallerySection';
import { MultiCitySection } from './sections/MultiCitySection';
import { TechnicalServices } from './sections/TechnicalServices';
import { PortfolioProjects } from './sections/PortfolioProjects';
import { CaseStudiesSection } from './sections/CaseStudiesSection';
import { ProcessSection } from './sections/ProcessSection';
import { FAQSection } from './sections/FAQ/FAQSection';
import { ContactCTA } from './sections/ContactCTA';
import { RelatedServicesSection } from './sections/RelatedServicesSection';
import { AdvantagesSection } from './sections/AdvantagesSection';

export const iconMap: Record<string, any> = {
  Mic, Camera, Lightbulb, Monitor, Wifi, Settings,
  Award, Shield, Users, Video, FileSearch, MapPin,
  MessageSquare, Search, FileText, CheckCircle, Play, Package,
  Music, Presentation,
  Truck: Package,
  Volume2: Mic,
};

type Props = {
  initialHeroData: any;
  initialServices: any[];
  initialCaseStudies: any[];
  initialAdvantages: any[];
  initialProcess: any[];
  initialPricing: any[];
  initialFaq: any[];
  initialGallery: any[];
  initialPortfolioProjects: any[];
  initialCities: any[];
  initialServiceCategories: any[];
  initialRelatedServices: any[];
  initialAllServiceItems: any[];
  initialSelectedServiceIds: string[];

  localIntro?: React.ReactNode;
  cityAnchorId?: string;
};

export default function ConferencesPageClient({
  initialHeroData,
  initialServices,
  initialCaseStudies,
  initialAdvantages,
  initialProcess,
  initialPricing,
  initialFaq,
  initialGallery,
  initialPortfolioProjects,
  initialCities,
  initialServiceCategories,
  initialRelatedServices,
  initialAllServiceItems,
  initialSelectedServiceIds,
  localIntro,
}: Props) {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();

  // ⭐ Startujemy z danymi z SSR
  const [heroData, setHeroData] = useState<any>(initialHeroData);

  const [services, setServices] = useState<any[]>(initialServices);
  const [caseStudies, setCaseStudies] = useState<any[]>(initialCaseStudies);
  const [advantages, setAdvantages] = useState<any[]>(initialAdvantages);
  const [process, setProcess] = useState<any[]>(initialProcess);
  const [pricing, setPricing] = useState<any[]>(initialPricing);
  const [faq, setFaq] = useState<any[]>(initialFaq);
  const [gallery, setGallery] = useState<any[]>(initialGallery);
  const [portfolioProjects, setPortfolioProjects] = useState<any[]>(initialPortfolioProjects);
  const [cities, setCities] = useState<any[]>(initialCities);
  const [serviceCategories, setServiceCategories] = useState<any[]>(initialServiceCategories);

  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [isContactFormOpen, setIsContactFormOpen] = useState(false);

  const [relatedServices, setRelatedServices] = useState<any[]>(initialRelatedServices);
  const [allServiceItems, setAllServiceItems] = useState<any[]>(initialAllServiceItems);

  const initialSet = useMemo(() => new Set(initialSelectedServiceIds), [initialSelectedServiceIds]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(initialSet);

  const [isEditingProcess, setIsEditingProcess] = useState(false);

  const [isEditingCities, setIsEditingCities] = useState(false);
  const [editingCity, setEditingCity] = useState<any>(null);
  const [isAddingCity, setIsAddingCity] = useState(false);
  const [newCityName, setNewCityName] = useState('');

  // ✅ Opcjonalnie: tylko w edit mode dociągamy świeże dane po stronie klienta

  const handleAddCity = async () => {
    if (!newCityName.trim()) return;

    try {
      const slug = newCityName.toLowerCase()
        .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e')
        .replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o')
        .replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

      const { error } = await supabase
        .from('conferences_cities')
        .insert({
          city_name: newCityName.trim(),
          name: newCityName.trim(),
          slug,
          is_active: true,
          display_order: cities.length + 1,
        });

      if (error) throw error;

      setNewCityName('');
      setIsAddingCity(false);
      showSnackbar('Miasto dodane!', 'success');
    } catch (error) {
      console.error('Error adding city:', error);
      showSnackbar('Błąd podczas dodawania miasta', 'error');
    }
  };

  const handleUpdateCity = async (cityData: any) => {
    try {
      const { error } = await supabase
        .from('conferences_cities')
        .update({
          city_name: cityData.city_name,
          name: cityData.city_name,
          voivodeship: cityData.voivodeship,
        })
        .eq('id', cityData.id);

      if (error) throw error;

      setEditingCity(null);
      showSnackbar('Miasto zaktualizowane!', 'success');
    } catch (error) {
      console.error('Error updating city:', error);
      showSnackbar('Błąd podczas aktualizacji', 'error');
    }
  };

  const handleDeleteCity = async (cityId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć to miasto?')) return;

    try {
      const { error } = await supabase
        .from('conferences_cities')
        .delete()
        .eq('id', cityId);

      if (error) throw error;

      showSnackbar('Miasto usunięte!', 'success');
    } catch (error) {
      console.error('Error deleting city:', error);
      showSnackbar('Błąd podczas usuwania miasta', 'error');
    }
  };

  // ✅ UWAGA: już nie blokujemy całej strony loaderem (SEO!)
  // Jeśli heroData jest null, nadal renderujemy resztę (a Hero masz w OfferLayout)
  return (
    <div className="min-h-screen bg-[#0f1119]">
      {localIntro}
      <TechnicalServices services={services} />

        {/* <GallerySection  /> */}

      <AdvantagesSection advantages={advantages} />

      {serviceCategories.length > 0 && (
        <DetailedServices setIsContactFormOpen={() => setIsContactFormOpen(true)} />
      )}

      {portfolioProjects.length > 0 && (
        <PortfolioProjects isEditMode={isEditMode} portfolioProjects={portfolioProjects} />
      )}

      <ProcessSection
        process={process}
        setIsEditingProcess={setIsEditingProcess}
        isEditingProcess={isEditingProcess}
      />

      {faq.length > 0 && (
        <CaseStudiesSection caseStudies={caseStudies} />
      )}

      <FAQSection faq={faq} setExpandedFaq={setExpandedFaq} expandedFaq={expandedFaq} />

      {(relatedServices.length > 0 || isEditMode) && (
        <RelatedServicesSection
          isEditMode={isEditMode}
          selectedServiceIds={selectedServiceIds}
          setSelectedServiceIds={setSelectedServiceIds}
          allServiceItems={allServiceItems}
          relatedServices={relatedServices}
        />
      )}

      {cities.length > 0 && (
        <MultiCitySection
          isEditMode={isEditMode}
          isEditingCities={isEditingCities}
          setIsEditingCities={setIsEditingCities}
          handleUpdateCity={handleUpdateCity}
          setEditingCity={setEditingCity}
          setIsAddingCity={setIsAddingCity}
          handleDeleteCity={handleDeleteCity}
          cities={cities}
          editingCity={editingCity}
          newCityName={newCityName}
          setNewCityName={setNewCityName}
          handleAddCity={handleAddCity}
          isAddingCity={isAddingCity}
        />
      )}

      <ContactCTA setIsContactFormOpen={setIsContactFormOpen} />

      <ContactFormWithTracking
        isOpen={isContactFormOpen}
        onClose={() => setIsContactFormOpen(false)}
        sourcePage="Konferencje"
        sourceSection="conferences"
        defaultEventType="Konferencja"
      />

      {/* Twoje animacje możesz zostawić, tylko nie dawaj opacity:0 na tekst SEO (H1/lead/FAQ). */}
      <style jsx global>{`
        @keyframes fade-in-up {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fade-in-up {
          animation: fade-in-up 0.8s ease-out forwards;
          opacity: 0;
        }
      `}</style>
    </div>
  );
}