'use client';

import { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Music,
  Volume2,
  Radio,
  Zap,
  Activity,
  Settings,
  Users,
  MapPin,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { EditableImageSection } from '@/components/EditableImageSection';
import { useEditMode } from '@/contexts/EditModeContext';

const iconMap: Record<string, any> = {
  CheckCircle2,
  Music,
  Volume2,
  Radio,
  Zap,
  Activity,
  Settings,
  Users,
  MapPin,
};

export function NaglosnieniaContent() {
  const { isEditMode } = useEditMode();
  const [features, setFeatures] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [featuresRes, applicationsRes] = await Promise.all([
        supabase
          .from('naglosnienie_features')
          .select('*')
          .eq('is_active', true)
          .order('order_index'),
        supabase
          .from('naglosnienie_applications')
          .select('*')
          .eq('is_active', true)
          .order('order_index'),
      ]);

      if (featuresRes.data) setFeatures(featuresRes.data);
      if (applicationsRes.data) setApplications(applicationsRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-16 w-16 animate-spin rounded-full border-4 border-[#d3bb73] border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      {features.length > 0 && (
        <section className="relative overflow-hidden bg-[#0f1119] py-24">
          {/* Animated Background Shapes */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="animate-float absolute left-10 top-20 h-72 w-72 rounded-full bg-[#d3bb73]/5 blur-3xl"></div>
            <div
              className="animate-float absolute right-20 top-40 h-96 w-96 rounded-full bg-[#800020]/5 blur-3xl"
              style={{ animationDelay: '1s' }}
            ></div>
            <div
              className="animate-float absolute bottom-20 left-1/3 h-80 w-80 rounded-full bg-[#d3bb73]/5 blur-3xl"
              style={{ animationDelay: '2s' }}
            ></div>

            {/* Geometric Shapes */}
            <div className="animate-rotate-slow absolute right-32 top-32 h-24 w-24 rotate-45 border border-[#d3bb73]/10"></div>
            <div className="animate-pulse-glow absolute bottom-40 left-20 h-32 w-32 rounded-full border border-[#d3bb73]/10"></div>
            <div className="absolute right-10 top-1/2 h-16 w-16 rotate-12 bg-gradient-to-br from-[#d3bb73]/10 to-transparent"></div>
          </div>

          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="animate-fade-in mb-16 text-center">
              <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">Co Oferujemy</h2>
              <div className="mx-auto h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {features.map((feature, index) => {
                const Icon = iconMap[feature.icon] || CheckCircle2;
                return (
                  <div
                    key={feature.id}
                    className={`animate-scale-in group relative flex items-start gap-3 overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 p-6 backdrop-blur-sm transition-all duration-500 ${
                      !isEditMode
                        ? 'hover:scale-105 hover:border-[#d3bb73]/30 hover:shadow-lg hover:shadow-[#d3bb73]/20'
                        : ''
                    }`}
                    style={{ animationDelay: `${index * 0.1}s` }}
                  >
                    {!isEditMode && (
                      <>
                        <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/5 via-transparent to-[#800020]/5 opacity-0 transition-opacity duration-500 group-hover:opacity-100"></div>
                        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[#d3bb73]/5 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"></div>
                      </>
                    )}

                    <Icon
                      className={`relative z-10 mt-0.5 h-5 w-5 flex-shrink-0 text-[#d3bb73] transition-transform duration-300 ${!isEditMode ? 'group-hover:scale-110' : ''}`}
                    />
                    <span className="relative z-10 font-light text-[#e5e4e2]/90">
                      {feature.title}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {applications.length > 0 && (
        <section className="relative overflow-hidden bg-[#1c1f33] py-24">
          <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/5 via-transparent to-[#800020]/5"></div>

          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="animate-fade-in mb-16 text-center">
              <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">Zastosowania</h2>
              <div className="mx-auto h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
            </div>

            <div className="grid gap-8 md:grid-cols-2">
              {applications.map((app, index) => (
                <div
                  key={app.id}
                  className={`animate-scale-in group relative h-96 overflow-hidden rounded-2xl border border-[#d3bb73]/20 transition-all duration-500 ${
                    !isEditMode
                      ? 'hover:scale-105 hover:border-[#d3bb73]/60 hover:shadow-2xl hover:shadow-[#d3bb73]/20'
                      : ''
                  }`}
                  style={{ animationDelay: `${index * 0.2}s` }}
                >
                  {!isEditMode && (
                    <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/30 via-transparent to-[#800020]/30 opacity-0 transition-opacity duration-500 group-hover:opacity-100"></div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119] via-[#0f1119]/70 to-transparent"></div>

                  <div className="absolute inset-0 overflow-hidden">
                    <img
                      src={app.image_url}
                      alt={app.title}
                      className={`h-full w-full object-cover transition-transform duration-700 ${!isEditMode ? 'group-hover:scale-110' : ''}`}
                    />
                  </div>

                  <div className="absolute bottom-0 left-0 right-0 z-20 p-8">
                    <div
                      className={`mb-4 h-1 w-16 transform bg-[#d3bb73] transition-all duration-500 ${!isEditMode ? 'group-hover:w-32' : ''}`}
                    ></div>
                    <h3
                      className={`mb-3 transform text-2xl font-light text-[#e5e4e2] transition-all duration-500 ${!isEditMode ? 'group-hover:translate-x-2' : ''}`}
                    >
                      {app.title}
                    </h3>
                    <p
                      className={`transform text-sm text-[#e5e4e2]/70 opacity-80 transition-all duration-500 ${!isEditMode ? 'group-hover:translate-x-2 group-hover:opacity-100' : ''}`}
                    >
                      {app.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
