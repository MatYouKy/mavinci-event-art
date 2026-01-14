'use client';

import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { PortfolioProject } from '@/lib/Pages/Home/getPortfolioProjects';

export default function Portfolio({ portfolioProjects }: { portfolioProjects: PortfolioProject[] }) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');



  const categories = ['all', ...Array.from(new Set(portfolioProjects.map(p => p.category)))];
  const filteredProjects = selectedCategory === 'all'
    ? portfolioProjects.slice(0, 6)
    : portfolioProjects.filter(p => p.category === selectedCategory).slice(0, 6);

  return (
    <section id="portfolio" className="relative py-24 md:py-32 bg-[#1c1f33] overflow-hidden" aria-labelledby="portfolio-heading">
      <div className="absolute inset-0 opacity-10">
        <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="portfolio-dots" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1" fill="#d3bb73" />
            </pattern>
            <pattern id="portfolio-lines" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
              <path d="M0 40 L80 40" stroke="#800020" strokeWidth="0.5" opacity="0.3" />
              <path d="M40 0 L40 80" stroke="#800020" strokeWidth="0.5" opacity="0.3" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#portfolio-dots)" />
          <rect width="100%" height="100%" fill="url(#portfolio-lines)" />
        </svg>
      </div>
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#d3bb73] rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-[#800020] rounded-full blur-3xl"></div>
      </div>
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16 md:mb-20">
          <div className="inline-block">
            <span className="text-[#d3bb73] text-sm md:text-base font-light tracking-widest uppercase mb-4 block animate-[fadeIn_0.6s_ease-out]">
              Portfolio
            </span>
            <h2 id="portfolio-heading" className="text-3xl sm:text-4xl md:text-5xl font-light text-[#e5e4e2] mb-6 animate-[fadeIn_0.8s_ease-out]">
              Nasze Realizacje Eventowe
            </h2>
            <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto animate-[scaleIn_1s_ease-out]"></div>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-3 mb-12">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-6 py-2 rounded-full text-sm font-light transition-all duration-300 ${
                selectedCategory === category
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#d3bb73]/10 border border-[#d3bb73]/30 text-[#d3bb73] hover:bg-[#d3bb73]/20'
              }`}
            >
              {category === 'all' ? 'Wszystkie' : category}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap justify-center gap-3 md:gap-4">
            {filteredProjects.map((project, index) => (
            <Link
              href={`/portfolio/${project.slug}`}
              key={project.id}
              className="group relative overflow-hidden rounded-2xl cursor-pointer block w-full md:w-[calc(33.333%-1.33rem)]"
              style={{
                animation: `fadeInUp 0.6s ease-out ${index * 0.1}s both`,
              }}
              onMouseEnter={() => setHoveredId(project.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div className="aspect-[4/5] relative overflow-hidden">
                <img
                  src={project.image_metadata?.desktop?.src || project.image}
                  alt={project.alt || project.title}
                  className="w-full h-full object-cover transition-all duration-700 group-hover:scale-110"
                />

                <div className="absolute inset-0 bg-gradient-to-t from-[#1c1f33] via-[#1c1f33]/60 to-transparent opacity-80 group-hover:opacity-95 transition-opacity duration-500"></div>

                <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-all duration-500 transform translate-y-[-10px] group-hover:translate-y-0">
                  <div className="w-10 h-10 rounded-full bg-[#d3bb73]/90 backdrop-blur-sm flex items-center justify-center hover:bg-[#d3bb73] transition-colors duration-300 hover:scale-110 transform">
                    <ArrowUpRight className="w-5 h-5 text-[#1c1f33]" />
                  </div>
                </div>

                <div className="absolute bottom-0 left-0 right-0 p-6 transform transition-all duration-500">
                  <div className="mb-3">
                    <span className="inline-block px-3 py-1 bg-[#d3bb73]/20 backdrop-blur-md border border-[#d3bb73]/40 rounded-full text-[#d3bb73] text-xs font-light tracking-wide">
                      {project.category}
                    </span>
                  </div>

                  <h3 className="text-xl md:text-2xl font-light text-[#e5e4e2] mb-2 transform transition-all duration-500 group-hover:translate-x-2">
                    {project.title}
                  </h3>

                  <p
                    className={`text-[#e5e4e2]/70 text-sm font-light leading-relaxed transition-all duration-500 ${
                      hoveredId === project.id
                        ? 'opacity-100 translate-y-0 max-h-20'
                        : 'opacity-0 translate-y-4 max-h-0'
                    }`}
                  >
                    {project.description}
                  </p>
                </div>

                <div className="absolute inset-0 border-2 border-transparent group-hover:border-[#d3bb73]/30 rounded-2xl transition-all duration-500 pointer-events-none"></div>
              </div>
            </Link>
          ))}
        </div>

        <div className="text-center mt-16 animate-[fadeIn_1.2s_ease-out]">
          <Link href="/portfolio" className="group inline-flex items-center gap-3 px-8 py-4 bg-transparent border-2 border-[#d3bb73] text-[#d3bb73] rounded-full font-light hover:bg-[#d3bb73] hover:text-[#1c1f33] transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-[#d3bb73]/30">
            Zobacz Wszystkie Projekty
            <ArrowUpRight className="w-5 h-5 group-hover:rotate-45 transition-transform duration-300" />
          </Link>
        </div>
      </div>

      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes scaleIn {
          from {
            transform: scaleX(0);
          }
          to {
            transform: scaleX(1);
          }
        }
      `}</style>
    </section>
  );
}
