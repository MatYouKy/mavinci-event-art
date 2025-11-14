'use client';

import { useState, useEffect } from 'react';
import { Eye, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { PortfolioProject, supabase } from '../lib/supabase';

export default function Portfolio() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [projects, setProjects] = useState<PortfolioProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('portfolio_projects')
        .select('*')
        .order('order_index', { ascending: true });

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      console.log('Fetched portfolio projects:', data);
      setProjects(data || []);
    } catch (error) {
      console.error('Error fetching projects:', error);
      setProjects([]);
    }
    setLoading(false);
  };

  const categories = ['all', ...Array.from(new Set(projects.map((p) => p.category)))];
  const filteredProjects =
    selectedCategory === 'all'
      ? projects.slice(0, 6)
      : projects.filter((p) => p.category === selectedCategory).slice(0, 6);

  return (
    <section
      id="portfolio"
      className="relative overflow-hidden bg-[#1c1f33] py-24 md:py-32"
      aria-labelledby="portfolio-heading"
    >
      <div className="absolute inset-0 opacity-10">
        <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern
              id="portfolio-dots"
              x="0"
              y="0"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="2" cy="2" r="1" fill="#d3bb73" />
            </pattern>
            <pattern
              id="portfolio-lines"
              x="0"
              y="0"
              width="80"
              height="80"
              patternUnits="userSpaceOnUse"
            >
              <path d="M0 40 L80 40" stroke="#800020" strokeWidth="0.5" opacity="0.3" />
              <path d="M40 0 L40 80" stroke="#800020" strokeWidth="0.5" opacity="0.3" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#portfolio-dots)" />
          <rect width="100%" height="100%" fill="url(#portfolio-lines)" />
        </svg>
      </div>
      <div className="absolute inset-0 opacity-5">
        <div className="absolute left-1/4 top-0 h-96 w-96 rounded-full bg-[#d3bb73] blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-[#800020] blur-3xl"></div>
      </div>
      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 text-center md:mb-20">
          <div className="inline-block">
            <span className="mb-4 block animate-[fadeIn_0.6s_ease-out] text-sm font-light uppercase tracking-widest text-[#d3bb73] md:text-base">
              Portfolio
            </span>
            <h2
              id="portfolio-heading"
              className="mb-6 animate-[fadeIn_0.8s_ease-out] text-3xl font-light text-[#e5e4e2] sm:text-4xl md:text-5xl"
            >
              Nasze Realizacje Eventowe
            </h2>
            <div className="mx-auto h-1 w-24 animate-[scaleIn_1s_ease-out] bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
          </div>
        </div>

        <div className="mb-12 flex flex-wrap justify-center gap-3">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`rounded-full px-6 py-2 text-sm font-light transition-all duration-300 ${
                selectedCategory === category
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'border border-[#d3bb73]/30 bg-[#d3bb73]/10 text-[#d3bb73] hover:bg-[#d3bb73]/20'
              }`}
            >
              {category === 'all' ? 'Wszystkie' : category}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-lg text-[#d3bb73]">Ładowanie projektów...</div>
          </div>
        ) : projects.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-[#e5e4e2]/60">Brak projektów do wyświetlenia</p>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-3 md:gap-4">
            {filteredProjects.map((project, index) => (
              <Link
                href={`/portfolio/${project.id}`}
                key={project.id}
                className="group relative block w-full cursor-pointer overflow-hidden rounded-2xl md:w-[calc(33.333%-1.33rem)]"
                style={{
                  animation: `fadeInUp 0.6s ease-out ${index * 0.1}s both`,
                }}
                onMouseEnter={() => setHoveredId(project.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div className="relative aspect-[4/5] overflow-hidden">
                  <img
                    src={project.image_metadata?.desktop?.src || project.image}
                    alt={project.alt || project.title}
                    className="h-full w-full object-cover transition-all duration-700 group-hover:scale-110"
                  />

                  <div className="absolute inset-0 bg-gradient-to-t from-[#1c1f33] via-[#1c1f33]/60 to-transparent opacity-80 transition-opacity duration-500 group-hover:opacity-95"></div>

                  <div className="absolute right-4 top-4 flex translate-y-[-10px] transform gap-2 opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100">
                    <div className="flex h-10 w-10 transform items-center justify-center rounded-full bg-[#d3bb73]/90 backdrop-blur-sm transition-colors duration-300 hover:scale-110 hover:bg-[#d3bb73]">
                      <Eye className="h-5 w-5 text-[#1c1f33]" />
                    </div>
                    <div className="flex h-10 w-10 transform items-center justify-center rounded-full bg-[#d3bb73]/90 backdrop-blur-sm transition-colors duration-300 hover:scale-110 hover:bg-[#d3bb73]">
                      <ArrowUpRight className="h-5 w-5 text-[#1c1f33]" />
                    </div>
                  </div>

                  <div className="absolute bottom-0 left-0 right-0 transform p-6 transition-all duration-500">
                    <div className="mb-3">
                      <span className="inline-block rounded-full border border-[#d3bb73]/40 bg-[#d3bb73]/20 px-3 py-1 text-xs font-light tracking-wide text-[#d3bb73] backdrop-blur-md">
                        {project.category}
                      </span>
                    </div>

                    <h3 className="mb-2 transform text-xl font-light text-[#e5e4e2] transition-all duration-500 group-hover:translate-x-2 md:text-2xl">
                      {project.title}
                    </h3>

                    <p
                      className={`text-sm font-light leading-relaxed text-[#e5e4e2]/70 transition-all duration-500 ${
                        hoveredId === project.id
                          ? 'max-h-20 translate-y-0 opacity-100'
                          : 'max-h-0 translate-y-4 opacity-0'
                      }`}
                    >
                      {project.description}
                    </p>
                  </div>

                  <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-transparent transition-all duration-500 group-hover:border-[#d3bb73]/30"></div>
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-16 animate-[fadeIn_1.2s_ease-out] text-center">
          <Link
            href="/portfolio"
            className="group inline-flex items-center gap-3 rounded-full border-2 border-[#d3bb73] bg-transparent px-8 py-4 font-light text-[#d3bb73] transition-all duration-300 hover:scale-105 hover:bg-[#d3bb73] hover:text-[#1c1f33] hover:shadow-lg hover:shadow-[#d3bb73]/30"
          >
            Zobacz Wszystkie Projekty
            <ArrowUpRight className="h-5 w-5 transition-transform duration-300 group-hover:rotate-45" />
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
