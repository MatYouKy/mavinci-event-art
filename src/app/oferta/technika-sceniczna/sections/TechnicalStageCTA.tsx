'use client';

import { motion } from 'framer-motion';
import { Settings } from 'lucide-react';

export default function TechnicalStageCTA() {
  return (
    <section className="relative bg-gradient-to-br from-[#0f1119] to-[#1c1f33] px-6 py-24 overflow-hidden">
      <div className="absolute left-0 top-0 h-96 w-96 rounded-full bg-[#d3bb73]/5 blur-3xl" />
      <div className="absolute right-0 bottom-0 h-96 w-96 rounded-full bg-[#800020]/5 blur-3xl" />

      <div className="relative z-10 mx-auto max-w-4xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <Settings className="mx-auto mb-6 h-16 w-16 text-[#d3bb73]" />
          <h2 className="mb-6 text-3xl font-light text-[#e5e4e2] md:text-4xl">
            Potrzebujesz Profesjonalnej Techniki?
          </h2>
          <p className="mx-auto mb-8 max-w-2xl text-lg font-light text-[#e5e4e2]/70">
            Skontaktuj się z nami, aby omówić wymagania techniczne Twojego eventu. Dobierzemy optymalny sprzęt i zapewnimy pełną obsługę.
          </p>
          <a
            href="/#kontakt"
            className="inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-3 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            Skontaktuj się z nami
          </a>
        </motion.div>
      </div>
    </section>
  );
}
