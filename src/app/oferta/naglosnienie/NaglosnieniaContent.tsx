'use client';

import { useState, useEffect } from 'react';
import { CheckCircle2, Music, Volume2, Radio, Zap, Activity, Settings, Users, MapPin } from 'lucide-react';
import { supabase } from '@/lib/supabase';
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
        supabase.from('naglosnienie_features').select('*').eq('is_active', true).order('order_index'),
        supabase.from('naglosnienie_applications').select('*').eq('is_active', true).order('order_index'),
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
        <div className="w-16 h-16 border-4 border-[#d3bb73] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      {features.length > 0 && (
        <section className="py-24 bg-[#0f1119] relative overflow-hidden">
          {/* Animated Background Shapes */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-20 left-10 w-72 h-72 bg-[#d3bb73]/5 rounded-full blur-3xl animate-float"></div>
            <div className="absolute top-40 right-20 w-96 h-96 bg-[#800020]/5 rounded-full blur-3xl animate-float" style={{ animationDelay: '1s' }}></div>
            <div className="absolute bottom-20 left-1/3 w-80 h-80 bg-[#d3bb73]/5 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }}></div>

            {/* Geometric Shapes */}
            <div className="absolute top-32 right-32 w-24 h-24 border border-[#d3bb73]/10 rotate-45 animate-rotate-slow"></div>
            <div className="absolute bottom-40 left-20 w-32 h-32 border border-[#d3bb73]/10 rounded-full animate-pulse-glow"></div>
            <div className="absolute top-1/2 right-10 w-16 h-16 bg-gradient-to-br from-[#d3bb73]/10 to-transparent rotate-12"></div>
          </div>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="text-center mb-16 animate-fade-in">
              <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">Co Oferujemy</h2>
              <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {features.map((feature, index) => {
                const Icon = iconMap[feature.icon] || CheckCircle2;
                return (
                  <div
                    key={feature.id}
                    className={`group relative flex items-start gap-3 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-xl p-6 transition-all duration-500 animate-scale-in overflow-hidden ${
                      !isEditMode ? 'hover:border-[#d3bb73]/30 hover:scale-105 hover:shadow-lg hover:shadow-[#d3bb73]/20' : ''
                    }`}
                    style={{ animationDelay: `${index * 0.1}s` }}
                  >
                    {!isEditMode && (
                      <>
                        <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/5 via-transparent to-[#800020]/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                        <div className="absolute -top-10 -right-10 w-32 h-32 bg-[#d3bb73]/5 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                      </>
                    )}

                    <Icon className={`w-5 h-5 text-[#d3bb73] flex-shrink-0 mt-0.5 relative z-10 transition-transform duration-300 ${!isEditMode ? 'group-hover:scale-110' : ''}`} />
                    <span className="text-[#e5e4e2]/90 font-light relative z-10">{feature.title}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {applications.length > 0 && (
        <section className="py-24 bg-[#1c1f33] relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/5 via-transparent to-[#800020]/5"></div>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="text-center mb-16 animate-fade-in">
              <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">Zastosowania</h2>
              <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              {applications.map((app, index) => (
                <div
                  key={app.id}
                  className={`group relative h-96 rounded-2xl overflow-hidden border border-[#d3bb73]/20 transition-all duration-500 animate-scale-in ${
                    !isEditMode ? 'hover:border-[#d3bb73]/60 hover:scale-105 hover:shadow-2xl hover:shadow-[#d3bb73]/20' : ''
                  }`}
                  style={{ animationDelay: `${index * 0.2}s` }}
                >
                  {!isEditMode && (
                    <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/30 via-transparent to-[#800020]/30 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119] via-[#0f1119]/70 to-transparent"></div>

                  <div className="absolute inset-0 overflow-hidden">
                    <img
                      src={app.image_url}
                      alt={app.title}
                      className={`w-full h-full object-cover transition-transform duration-700 ${!isEditMode ? 'group-hover:scale-110' : ''}`}
                    />
                  </div>

                  <div className="absolute bottom-0 left-0 right-0 p-8 z-20">
                    <div className={`h-1 w-16 bg-[#d3bb73] mb-4 transform transition-all duration-500 ${!isEditMode ? 'group-hover:w-32' : ''}`}></div>
                    <h3 className={`text-2xl font-light text-[#e5e4e2] mb-3 transform transition-all duration-500 ${!isEditMode ? 'group-hover:translate-x-2' : ''}`}>
                      {app.title}
                    </h3>
                    <p className={`text-[#e5e4e2]/70 text-sm transform transition-all duration-500 opacity-80 ${!isEditMode ? 'group-hover:opacity-100 group-hover:translate-x-2' : ''}`}>
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
