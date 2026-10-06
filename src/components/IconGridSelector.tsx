'use client';

import { supabase } from '@/lib/supabase/browser';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';

interface CustomIcon {
  id: string;
  name: string;
  svg_code: string;
  preview_color?: string;
}

interface IconGridSelectorProps {
  value: string;
  onChange: (iconId: string) => void;
  label?: string;
}

export function IconGridSelector({ value, onChange, label }: IconGridSelectorProps) {
  const [icons, setIcons] = useState<CustomIcon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchIcons = async () => {
      try {
        const { data, error } = await supabase
          .from('custom_icons')
          .select('id, name, svg_code, preview_color')
          .order('name');

        if (error) throw error;
        if (data) {
          setIcons(data);
        }
      } catch (error) {
        console.error('Error fetching icons:', error);
        setError('Nie udało się wczytać biblioteki ikon. Sprawdź połączenie i uprawnienia.');
      } finally {
        setLoading(false);
      }
    };

    fetchIcons();
  }, []);

  if (loading) {
    return (
      <div className="space-y-2">
        {label && <label className="block text-sm text-[#e5e4e2]/70">{label}</label>}
        <div className="rounded-lg border border-[#d3bb73]/20 bg-[#211019] p-4">
          <p className="text-center text-sm text-[#e5e4e2]/50">Ładowanie ikon...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {label && <label className="block text-sm text-[#e5e4e2]/70">{label}</label>}
      {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
      {!error && !icons.length && <p className="text-sm text-[#e5e4e2]/60">Brak dostępnych ikon w bibliotece. Możesz zapisać format z ikoną domyślną.</p>}
      <div className="max-h-[240px] overflow-y-auto rounded-lg border border-[#d3bb73]/20 bg-[#211019] p-3">
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {icons.map((icon) => {
            const isSelected = value === icon.id;
            return (
              <button
                key={icon.id}
                type="button"
                onClick={() => onChange(icon.id)}
                aria-label={icon.name}
                aria-pressed={isSelected}
                className={`group relative flex items-center justify-center rounded-lg border p-2 transition-all hover:bg-[#d3bb73]/10 ${
                  isSelected
                    ? 'border-[#d3bb73]/20 bg-[#d3bb73]/20'
                    : 'border-[#d3bb73]/20 bg-[#160c12] hover:border-[#d3bb73]/50'
                }`}
                title={icon.name}
              >
                {isSelected && (
                  <div className="absolute -right-1 -top-1 rounded-full bg-[#d3bb73] p-0.5">
                    <Check className="h-2.5 w-2.5 text-[#1c1f33]" />
                  </div>
                )}
                <div
                  className={`h-5 w-5 transition-colors ${
                    isSelected ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/70 group-hover:text-[#d3bb73]'
                  }`}
                  dangerouslySetInnerHTML={{ __html: icon.svg_code }}
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
