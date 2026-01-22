'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase/browser';
import { CustomIcon } from '@/components/UI/CustomIcon/CustomIcon';

interface Feature {
  id: string;
  title: string;
  description: string;
  icon_id: string | null;
  order_index: number;
}

export default function TechnicalStageFeatures() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFeatures();

    const channel = supabase
      .channel('tech_features_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'technical_stage_features' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setFeatures((prev) =>
              [...prev, payload.new as Feature].sort((a, b) => a.order_index - b.order_index),
            );
          } else if (payload.eventType === 'UPDATE') {
            setFeatures((prev) =>
              prev.map((f) => (f.id === payload.new.id ? (payload.new as Feature) : f)),
            );
          } else if (payload.eventType === 'DELETE') {
            setFeatures((prev) => prev.filter((f) => f.id !== payload.old.id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchFeatures = async () => {
    try {
      const { data, error } = await supabase
        .from('technical_stage_features')
        .select('*')
        .eq('is_visible', true)
        .order('order_index', { ascending: true });

      if (error) throw error;
      setFeatures(data || []);
    } catch (error) {
      console.error('Error fetching features:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="py-24 text-center text-[#e5e4e2]/60">Ładowanie...</div>;
  }

  return (
    <section className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-16 text-center"
        >
          <h2 className="mb-4 text-4xl font-light text-[#e5e4e2] md:text-5xl">Co oferujemy?</h2>
          <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
          <p className="mx-auto max-w-2xl text-lg font-light text-[#e5e4e2]/70">
            Kompleksowe rozwiązania techniczne dla Twojego eventu
          </p>
        </motion.div>

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, index) => (
            <motion.div
              key={feature.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="group relative overflow-hidden rounded-2xl border border-[#d3bb73]/10 bg-[#0f1119]/50 p-8 backdrop-blur-sm transition-all duration-300 hover:border-[#d3bb73]/30 hover:shadow-xl hover:shadow-[#d3bb73]/5"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

              <div className="relative z-10">
                {feature.icon_id && (
                  <div className="mb-6 inline-flex items-center justify-center rounded-xl bg-[#d3bb73]/10 p-4 text-[#d3bb73] ring-1 ring-[#d3bb73]/20 transition-transform duration-300 group-hover:scale-110">
                    <CustomIcon iconId={feature.icon_id} className="h-8 w-8" />
                  </div>
                )}

                <h3 className="mb-3 text-xl font-light text-[#e5e4e2]">{feature.title}</h3>

                <p className="font-light leading-relaxed text-[#e5e4e2]/60">
                  {feature.description}
                </p>
              </div>

              <div className="absolute bottom-0 left-0 h-1 w-0 bg-gradient-to-r from-[#d3bb73] to-[#c5a960] transition-all duration-300 group-hover:w-full" />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
