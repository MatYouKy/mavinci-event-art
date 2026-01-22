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
        {portfolioProjects.slice(0, 6).map((project, idx) => (
          <Link
            key={project.id}
            href={`/portfolio/${project.slug || project.id}`}
            className="group relative overflow-hidden rounded-xl aspect-video cursor-pointer transform hover:scale-105 transition-all duration-500 animate-fade-in-up"
            style={{ animationDelay: `${idx * 100}ms` }}
          >
            <img
              src={project.image || project.image_url}
              alt={project.alt || project.title}
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <h3 className="text-white font-medium mb-1">{project.title}</h3>
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
