'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { CustomIcon } from '@/components/UI/CustomIcon/CustomIcon';

interface Service {
  id: string;
  title: string;
  description: string;
  icon_id: string | null;
  order_index: number;
}

export default function TechnicalStageServices() {
  const [services, setServices] = useState<Service[]>([]);

  useEffect(() => {
    fetchServices();

    const channel = supabase
      .channel('tech_services_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'technical_stage_services' }, () => {
        fetchServices();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchServices = async () => {
    try {
      const { data, error } = await supabase
        .from('technical_stage_services')
        .select('*')
        .eq('is_visible', true)
        .order('order_index', { ascending: true });

      if (error) throw error;
      setServices(data || []);
    } catch (error) {
      console.error('Error fetching services:', error);
    }
  };

  if (services.length === 0) return null;

  return (
    <section className="bg-[#0f1119] px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-16 text-center"
        >
          <h2 className="mb-4 text-4xl font-light text-[#e5e4e2] md:text-5xl">
            Nasze usługi
          </h2>
          <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
          <p className="mx-auto max-w-2xl text-lg font-light text-[#e5e4e2]/70">
            Profesjonalna technika sceniczna na każdy event
          </p>
        </motion.div>

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service, index) => (
            <motion.div
              key={service.id}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1c1f33] to-[#1c1f33]/50 p-8 transition-all duration-300 hover:shadow-2xl hover:shadow-[#d3bb73]/10"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/10 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

              <div className="relative z-10">
                {service.icon_id && (
                  <div className="mb-6 inline-flex rounded-xl bg-[#d3bb73]/10 p-4 ring-1 ring-[#d3bb73]/20">
                    <CustomIcon iconId={service.icon_id} className="h-10 w-10 text-[#d3bb73]" />
                  </div>
                )}

                <h3 className="mb-4 text-2xl font-light text-[#e5e4e2]">
                  {service.title}
                </h3>

                <p className="font-light leading-relaxed text-[#e5e4e2]/70">
                  {service.description}
                </p>
              </div>

              <div className="absolute bottom-0 right-0 h-32 w-32 translate-x-16 translate-y-16 rounded-full bg-[#d3bb73]/5 blur-2xl transition-transform duration-300 group-hover:translate-x-8 group-hover:translate-y-8" />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
