'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useWebsiteEdit } from '@/hooks/useWebsiteEdit';
import TechnicalStageFeatures from './sections/TechnicalStageFeatures';
import TechnicalStageServices from './sections/TechnicalStageServices';
import TechnicalStageGallery from './sections/TechnicalStageGallery';
import TechnicalStagePackages from './sections/TechnicalStagePackages';
import TechnicalStageCTA from './sections/TechnicalStageCTA';

export default function TechnikaScenicznaPage() {
  return (
    <main className="min-h-screen bg-[#0f1119]">
      <TechnicalStageFeatures />
      <TechnicalStageServices />
      <TechnicalStageGallery />
      <TechnicalStagePackages />
      <TechnicalStageCTA />
    </main>
  );
}
