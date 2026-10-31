import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import React, { FC } from 'react';
interface PortfolioProjectsProps {
  isEditMode: boolean;
  portfolioProjects: any[];
  cityName?: string;
  cityNames?: Record<string, string>;
}

export const PortfolioProjects:FC<PortfolioProjectsProps> = ({ isEditMode, portfolioProjects, cityName, cityNames = {} }) => {
  return (
    <section className="py-20 px-6">
    <div className="max-w-7xl mx-auto">
      <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center">
        Nasze realizacje
      </h2>
      <p className="text-[#e5e4e2]/60 text-center mb-16">
        {cityName ? `Planujesz konferencję w lokalizacji ${cityName}? Zobacz przykłady naszego zaplecza i pracy realizatorów. Podpisy wskazują rzeczywiste miejsca wydarzeń.` : 'Przykłady obsłużonych konferencji i wydarzeń biznesowych'}
      </p>

      {isEditMode && (
        <div className="bg-white/[0.04] border border-white/5 rounded-xl p-6 mb-8">
          <p className="text-[#e5e4e2] text-sm mb-2">
            Dobór przykładów ustawisz w edycji realizacji, w sekcji „Miasto realizacji i strony konferencji”. Tag „konferencje” nadal działa jako domyślny wybór.
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
            <picture>
            {project.image_metadata?.mobile?.src && <source media="(max-width: 767px)" srcSet={project.image_metadata.mobile.src} />}
            <img
              src={project.image_metadata?.desktop?.src || project.image || project.image_url}
              alt={project.alt || project.title}
              className="aspect-video w-full object-cover"
              width={800}
              height={450}
              loading="lazy"
              decoding="async"
            />
            </picture>
            <div className="flex-1">
              <div className="p-4">
                <h3 className="mb-1 break-words text-base font-medium uppercase leading-relaxed text-white">{project.title}</h3>
                <p className="mb-1 text-sm text-[#d3bb73]">{project.location && project.location !== 'Polska' ? `Miejsce realizacji: ${project.location}` : cityNames[project.event_city_slug] ? `Miejsce realizacji: ${cityNames[project.event_city_slug]}` : 'Realizacja MAVINCI'}</p>
                {project.description && <p className="mt-3 text-sm leading-6 text-white/65">{project.description}</p>}
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
