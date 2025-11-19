import { ConferencesGalleryEditor } from '@/components/ConferencesGalleryEditor';
import React, { FC } from 'react';

interface GallerySectionProps {
  isEditMode: boolean;
  gallery: any[];
  loadData: () => void;
}

export const GallerySection:FC<GallerySectionProps> = ({ isEditMode, gallery, loadData }) => {
  return (
    <section className="py-20 px-6">
            <div className="max-w-7xl mx-auto">
              <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center animate-fade-in-up">
                Nasze realizacje w obiektywie
              </h2>
              <p className="text-[#e5e4e2]/60 text-center mb-16 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
                Galeria zdjęć z obsłużonych konferencji
              </p>

              {isEditMode && (
                <ConferencesGalleryEditor
                  items={gallery}
                  onUpdate={loadData}
                />
              )}

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {gallery.map((image, idx) => (
                  <div
                    key={image.id}
                    className="group relative overflow-hidden rounded-lg aspect-square cursor-pointer animate-fade-in-up"
                    style={{ animationDelay: `${idx * 50}ms` }}
                  >
                    <img
                      src={image.image_url}
                      alt={image.caption || 'Konferencja'}
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <div className="absolute bottom-0 left-0 right-0 p-3">
                        {image.title && (
                          <h3 className="text-white font-medium text-sm mb-1">{image.title}</h3>
                        )}
                        {image.caption && (
                          <p className="text-white/80 text-xs">{image.caption}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
  )
}
