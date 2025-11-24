'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Mic, Camera, Lightbulb, Monitor, Wifi, Settings,
  Award, Shield, Users, Video, FileSearch, MapPin,
  MessageSquare, Search, FileText, CheckCircle, Play, Package,
  ChevronDown, Mail, ArrowLeft, Presentation, Music, Trash2, Plus, Edit2
} from 'lucide-react';
import Link from 'next/link';
import ContactFormWithTracking from '@/components/ContactFormWithTracking';
import { useEditMode } from '@/contexts/EditModeContext';
import { PageHeroImage } from '@/components/PageHeroImage';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
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
import { useSnackbar } from '@/contexts/SnackbarContext';


export const iconMap: Record<string, any> = {
  Mic, Camera, Lightbulb, Monitor, Wifi, Settings,
  Award, Shield, Users, Video, FileSearch, MapPin,
  MessageSquare, Search, FileText, CheckCircle, Play, Package,
  Music, Presentation,
  Volume2: Mic, Truck: Package
};

export default function ConferencesPage() {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();
  
  const [heroData, setHeroData] = useState<any>(null);

  const [services, setServices] = useState<any[]>([]);
  const [caseStudies, setCaseStudies] = useState<any[]>([]);
  const [advantages, setAdvantages] = useState<any[]>([]);
  const [process, setProcess] = useState<any[]>([]);
  const [pricing, setPricing] = useState<any[]>([]);
  const [faq, setFaq] = useState<any[]>([]);
  const [gallery, setGallery] = useState<any[]>([]);
  const [portfolioProjects, setPortfolioProjects] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);
  const [serviceCategories, setServiceCategories] = useState<any[]>([]);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [isContactFormOpen, setIsContactFormOpen] = useState(false);
  const [relatedServices, setRelatedServices] = useState<any[]>([]);
  const [allServiceItems, setAllServiceItems] = useState<any[]>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());
  const [isEditingProcess, setIsEditingProcess] = useState(false);

  const [isEditingCities, setIsEditingCities] = useState(false);
  const [editingCity, setEditingCity] = useState<any>(null);
  const [isAddingCity, setIsAddingCity] = useState(false);
  const [newCityName, setNewCityName] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [
      heroRes,
      servicesRes,
      caseStudiesRes,
      advantagesRes,
      processRes,
      pricingRes,
      faqRes,
      portfolioRes,
      citiesRes,
      serviceCategoriesRes,
      relatedServicesRes,
      allServiceItemsRes,
      galleryRes,
    ] = await Promise.all([
      supabase.from('conferences_hero').select('*').eq('is_active', true).single(),
      supabase.from('conferences_services').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_case_studies').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_advantages').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_process').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_pricing').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_faq').select('*').eq('is_active', true).order('display_order'),
      supabase.from('portfolio_projects').select('*').contains('tags', ['konferencje']).order('order_index'),
      supabase.from('conferences_cities').select('*').eq('is_active', true).order('display_order'),
      supabase
        .from('conferences_service_categories')
        .select(`*, items:conferences_service_items(*)`)
        .eq('is_active', true)
        .order('display_order'),
      supabase
        .from('conferences_related_services')
        .select(`*, service_item:conferences_service_items(*)`)
        .eq('is_active', true)
        .order('display_order'),
      supabase
        .from('conferences_service_items')
        .select('*')
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('conferences_gallery')
        .select('*')
        .eq('is_active', true)
        .order('display_order'),
    ]);

    if (heroRes.data) {
      setHeroData(heroRes.data);
    }
    if (servicesRes.data) setServices(servicesRes.data);
    if (caseStudiesRes.data) setCaseStudies(caseStudiesRes.data);
    if (advantagesRes.data) setAdvantages(advantagesRes.data);
    if (processRes.data) setProcess(processRes.data);
    if (pricingRes.data) setPricing(pricingRes.data);
    if (faqRes.data) setFaq(faqRes.data);
    if (portfolioRes.data) setPortfolioProjects(portfolioRes.data);
    if (citiesRes.data) setCities(citiesRes.data);
    if (serviceCategoriesRes.data) setServiceCategories(serviceCategoriesRes.data);

    if (relatedServicesRes.data) {
      setRelatedServices(relatedServicesRes.data.map((r) => r.service_item));
      setSelectedServiceIds(new Set(relatedServicesRes.data.map((r) => r.service_item_id)));
    }
    if (allServiceItemsRes.data) setAllServiceItems(allServiceItemsRes.data);
    if (galleryRes.data) setGallery(galleryRes.data);
  };

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

      await loadData();
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

      await loadData();
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

      await loadData();
      showSnackbar('Miasto usunięte!', 'success');
    } catch (error) {
      console.error('Error deleting city:', error);
      showSnackbar('Błąd podczas usuwania miasta', 'error');
    }
  };

  if (!heroData) {
    return (
      <>
        <div className="min-h-screen bg-[#0f1119] flex items-center justify-center">
          <div className="text-[#d3bb73]">Ładowanie...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="min-h-screen bg-[#0f1119]">
        {/* Hero Section with PageHeroImage */}
        
        <TechnicalServices services={services} isEditMode={isEditMode} loadData={loadData} />
        {(gallery.length > 0 || isEditMode) && (
          <GallerySection isEditMode={isEditMode} gallery={gallery} loadData={loadData} />
        )}
        <AdvantagesSection advantages={advantages} />

        {serviceCategories.length > 0 && (
          <DetailedServices setIsContactFormOpen={() => setIsContactFormOpen(true)} />
        )}

{portfolioProjects.length > 0 && (
          <PortfolioProjects isEditMode={isEditMode} portfolioProjects={portfolioProjects} />
        )}
        <ProcessSection isEditMode={isEditMode} process={process} setIsEditingProcess={setIsEditingProcess} isEditingProcess={isEditingProcess} loadData={loadData} />
        
        {/* <PricingSection isEditMode={isEditMode} pricing={pricing} loadData={loadData} setIsContactFormOpen={setIsContactFormOpen} /> */}
     

        {/* FAQ */}
        {faq.length > 0 && (
          <CaseStudiesSection caseStudies={caseStudies} />
        )}
        <FAQSection faq={faq} setExpandedFaq={setExpandedFaq} expandedFaq={expandedFaq} />

        {/* Related Services Section */}
        {(relatedServices.length > 0 || isEditMode) && (
          <RelatedServicesSection isEditMode={isEditMode} selectedServiceIds={selectedServiceIds} setSelectedServiceIds={setSelectedServiceIds} allServiceItems={allServiceItems} loadData={loadData} relatedServices={relatedServices} />
        )}
        {cities.length > 0 && (
          <MultiCitySection isEditMode={isEditMode} isEditingCities={isEditingCities} setIsEditingCities={setIsEditingCities} handleUpdateCity={handleUpdateCity} setEditingCity={setEditingCity} setIsAddingCity={setIsAddingCity} handleDeleteCity={handleDeleteCity} cities={cities} editingCity={editingCity} newCityName={newCityName} setNewCityName={setNewCityName} handleAddCity={handleAddCity} isAddingCity={isAddingCity} />
        )}

        <ContactCTA setIsContactFormOpen={setIsContactFormOpen} />

        <ContactFormWithTracking
          isOpen={isContactFormOpen}
          onClose={() => setIsContactFormOpen(false)}
          sourcePage="Konferencje"
          sourceSection="conferences"
          defaultEventType="Konferencja"
        />

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
    </>
  );
}