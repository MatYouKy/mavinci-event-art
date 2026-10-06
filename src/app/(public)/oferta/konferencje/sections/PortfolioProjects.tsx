import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import React, { FC } from 'react';
interface PortfolioProjectsProps {
  isEditMode: boolean;
  portfolioProjects: any[];
}

export const PortfolioProjects:FC<PortfolioProjectsProps> = ({ isEditMode, portfolioProjects }) => {
  return (
    <section className="py-20 px-6">
    <div className="max-w-7xl mx-auto">
      <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center">
        Nasze realizacje
      </h2>
      <p className="text-[#e5e4e2]/60 text-center mb-16">
        Przykłady obsłużonych konferencji i eventów
      </p>

      {isEditMode && (
        <div className="bg-[#1c1f33] border-2 border-[#d3bb73] rounded-xl p-6 mb-8">
          <p className="text-[#e5e4e2] text-sm mb-2">
            <strong>Tip:</strong> Ta sekcja wyświetla projekty z Portfolio oznaczone tagiem <code className="bg-[#d3bb73]/20 px-2 py-1 rounded text-[#d3bb73]">konferencje</code>
          </p>
          <Link href="/portfolio" className="text-[#d3bb73] hover:underline text-sm">
            → Zarządzaj projektami w Portfolio
          </Link>
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {portfolioProjects.slice(0, 6).map((project) => (
          <Link
            key={project.id}
            href={`/portfolio/${project.slug || project.id}`}
            className="group flex flex-col overflow-hidden rounded-xl bg-white/[0.04] transition-colors hover:bg-white/[0.08]"
            prefetch={false}
          >
            <img
              src={project.image || project.image_url}
              alt={project.alt || project.title}
              className="aspect-video w-full object-cover"
              width={800}
              height={450}
              loading="lazy"
              decoding="async"
            />
            <div className="flex-1">
              <div className="p-4">
                <h3 className="mb-1 break-words text-base font-medium uppercase leading-relaxed text-white">{project.title}</h3>
                {project.location && project.location !== 'Polska' && <p className="mb-1 text-sm text-[#d3bb73]">{project.location}</p>}
                {project.client && (
                  <p className="text-white/80 text-sm">{project.client}</p>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {portfolioProjects.length > 6 && (
        <div className="text-center mt-8">
          <Link
            href="/portfolio"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
          >
            Zobacz wszystkie projekty
            <ArrowLeft className="w-4 h-4 rotate-180" />
          </Link>
        </div>
      )}
    </div>
  </section>
  )
}
