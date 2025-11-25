'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Edit2, Plus, GripVertical } from 'lucide-react';
import { useQuizShowFormats } from '@/hooks/useQuizShowFormats';
import { useWebsiteEdit } from '@/hooks/useWebsiteEdit';
import { CustomIcon } from '@/components/UI/CustomIcon/CustomIcon';
import QuizFormatEditModal from './QuizFormatEditModal';

interface QuizShowsTypesProps {
  title?: string;
  subtitle?: string;
}

export default function QuizShowsTypes({
  title = 'Formaty teleturniejów',
  subtitle = 'Od prostych quizów po multimedialne widowiska',
}: QuizShowsTypesProps) {
  const { formats, loading } = useQuizShowFormats();
  const { canEdit } = useWebsiteEdit();
  const [editingFormatId, setEditingFormatId] = useState<string | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);

  if (loading) {
    return (
      <section className="bg-[#0f1119] px-6 py-24">
        <div className="mx-auto max-w-7xl text-center">
          <p className="text-[#e5e4e2]/60">Ładowanie formatów...</p>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="relative bg-[#0f1119] px-6 py-24 overflow-hidden">
        {/* Subtle Background Decorations */}
        <div className="absolute left-0 top-1/4 h-64 w-64 rounded-full bg-[#d3bb73]/5 blur-3xl" />
        <div className="absolute right-0 bottom-1/4 h-64 w-64 rounded-full bg-[#800020]/5 blur-3xl" />

        <div className="relative z-10 mx-auto max-w-7xl">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mb-20 text-center"
          >
            <h2 className="mb-4 text-4xl font-light text-[#e5e4e2] md:text-5xl">
              {title}
            </h2>
            <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
            <p className="mx-auto max-w-2xl text-lg font-light text-[#e5e4e2]/70">
              {subtitle}
            </p>

            {/* Add New Button */}
            {canEdit && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => setIsAddingNew(true)}
                className="mt-8 inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-6 py-3 text-sm font-light text-[#d3bb73] transition-all hover:bg-[#d3bb73]/20"
              >
                <Plus className="h-4 w-4" />
                Dodaj format
              </motion.button>
            )}
          </motion.div>

          {/* Alternating Layout */}
          <div className="space-y-32">
            {formats.map((format, index) => {
              const isLeft = format.layout_direction === 'left';

              return (
                <motion.div
                  key={format.id}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{ duration: 0.7, delay: 0.2 }}
                  className={`relative flex flex-col gap-12 ${
                    isLeft ? 'lg:flex-row' : 'lg:flex-row-reverse'
                  } items-center`}
                >
                  {/* Edit Controls */}
                  {canEdit && (
                    <div className="absolute -top-4 right-0 z-20 flex items-center gap-2">
                      <button
                        onClick={() => setEditingFormatId(format.id)}
                        className="rounded-full bg-[#d3bb73]/10 p-2 text-[#d3bb73] backdrop-blur-sm transition-colors hover:bg-[#d3bb73]/20"
                        title="Edytuj format"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <div
                        className="cursor-move rounded-full bg-[#d3bb73]/10 p-2 text-[#d3bb73] backdrop-blur-sm"
                        title="Przeciągnij aby zmienić kolejność"
                      >
                        <GripVertical className="h-4 w-4" />
                      </div>
                    </div>
                  )}

                  {/* Image Side */}
                  <motion.div
                    initial={{ opacity: 0, x: isLeft ? -50 : 50 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8, delay: 0.3 }}
                    className="relative w-full lg:w-1/2"
                  >
                    <div className="group relative aspect-[4/3] overflow-hidden rounded-2xl">
                      {format.image_url && (
                        <img
                          src={format.image_url}
                          alt={format.title}
                          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119]/60 via-transparent to-transparent" />
                      <div className="absolute inset-0 rounded-2xl border border-[#d3bb73]/20 transition-colors group-hover:border-[#d3bb73]/40" />
                    </div>

                    <div className={`absolute -z-10 h-full w-full rounded-2xl bg-gradient-to-br from-[#d3bb73]/10 to-[#800020]/10 blur-2xl ${
                      isLeft ? '-right-8 -bottom-8' : '-left-8 -bottom-8'
                    }`} />
                  </motion.div>

                  {/* Content Side */}
                  <motion.div
                    initial={{ opacity: 0, x: isLeft ? 50 : -50 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8, delay: 0.4 }}
                    className="w-full lg:w-1/2"
                  >
                    <div className="space-y-6">
                      {/* Icon */}
                      <div className="inline-flex items-center justify-center rounded-xl bg-[#d3bb73]/10 p-4 text-[#d3bb73] ring-1 ring-[#d3bb73]/20">
                        {format.icon_id ? (
                          <CustomIcon iconId={format.icon_id} className="h-10 w-10" />
                        ) : (
                          <div className="h-10 w-10" />
                        )}
                      </div>

                      {/* Level Badge */}
                      <div className="inline-block rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/5 px-4 py-1.5 text-sm font-light text-[#d3bb73]">
                        {format.level}
                      </div>

                      {/* Title */}
                      <h3 className="text-3xl font-light text-[#e5e4e2] lg:text-4xl">
                        {format.title}
                      </h3>

                      {/* Description */}
                      <p className="text-lg font-light leading-relaxed text-[#e5e4e2]/70">
                        {format.description}
                      </p>

                      {/* Features List */}
                      <div className="space-y-3 pt-4">
                        {format.features.map((feature, idx) => (
                          <motion.div
                            key={idx}
                            initial={{ opacity: 0, x: -20 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.5, delay: 0.5 + idx * 0.1 }}
                            className="flex items-start gap-3"
                          >
                            <div className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#d3bb73]" />
                            <span className="font-light text-[#e5e4e2]/80">
                              {feature}
                            </span>
                          </motion.div>
                        ))}
                      </div>

                      {/* Learn More Link */}
                      <motion.div
                        initial={{ opacity: 0 }}
                        whileInView={{ opacity: 1 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.6, delay: 0.8 }}
                        className="pt-4"
                      >
                        <button className="group inline-flex items-center gap-2 text-[#d3bb73] transition-all hover:gap-4">
                          <span className="text-sm font-light">Dowiedz się więcej</span>
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      </motion.div>
                    </div>
                  </motion.div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Edit Modal */}
      {(editingFormatId || isAddingNew) && (
        <QuizFormatEditModal
          formatId={editingFormatId}
          onClose={() => {
            setEditingFormatId(null);
            setIsAddingNew(false);
          }}
        />
      )}
    </>
  );
}
