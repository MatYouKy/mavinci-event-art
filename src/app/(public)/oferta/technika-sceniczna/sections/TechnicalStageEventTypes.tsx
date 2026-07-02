'use client';

import { motion } from 'framer-motion';

const eventTypes = [
  'Koncerty',
  'Konferencje',
  'Gale',
  'Eventy firmowe',
  'Bankiety',
  'Pikniki',
  'Festiwale',
  'Wydarzenia sportowe',
  'Premiery produktów',
  'Kongresy',
  'Targi',
];

export default function TechnicalStageEventTypes() {
  return (
    <section className="border-b border-[#d3bb73]/10 px-4 py-14 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center"
        >
          <h2 className="mb-8 text-2xl font-light text-[#e5e4e2] sm:text-3xl">
            Obsługujemy
          </h2>
          <div className="flex flex-wrap justify-center gap-2.5 sm:gap-3">
            {eventTypes.map((type, index) => (
              <motion.span
                key={type}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.04 }}
                className="rounded-full border border-[#d3bb73]/20 bg-[#d3bb73]/5 px-4 py-2 text-sm font-medium text-[#e5e4e2]/90 transition-colors duration-200 hover:border-[#d3bb73]/40 hover:bg-[#d3bb73]/10 sm:px-5 sm:py-2.5 sm:text-[0.9rem]"
              >
                {type}
              </motion.span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
