'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Search, X, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

type LocationRow = {
  id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  formatted_address: string | null;
};

type Props = {
  organizationId: string;
  currentLocationId?: string | null;
  onLocationChange: (locationId: string | null) => void;
  editMode: boolean;
  onOpenAddLocation?: () => void;
};

function labelForInput(loc: LocationRow | null) {
  // ✅ tylko nazwa w inpucie
  return (loc?.name || '').trim();
}

function suggestionTitle(loc: LocationRow) {
  return (loc.name || loc.formatted_address || '—').trim();
}

function suggestionSub(loc: LocationRow) {
  // ✅ w podpowiedziach możesz dalej mieć adres (pomaga rozróżniać)
  const line = [loc.address, loc.postal_code, loc.city, loc.country].filter(Boolean).join(', ');
  return line || (loc.formatted_address || '');
}

/**
 * PostgREST OR: wartości w cudzysłowie (przecinki w query nie rozwalą parsera)
 */
function quoteForOrIlike(raw: string) {
  const pattern = `%${raw}%`;
  const safe = pattern.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `"${safe}"`;
}

export default function OrganizationLocationPicker({
  organizationId,
  currentLocationId,
  onLocationChange,
  editMode,
  onOpenAddLocation,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [currentLocation, setCurrentLocation] = useState<LocationRow | null>(null);

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [fetchError, setFetchError] = useState<string>('');
  const [isUserTyping, setIsUserTyping] = useState(false);

  // fetch current location
  useEffect(() => {
    let alive = true;

    const run = async () => {
      if (!currentLocationId) {
        if (!alive) return;
        setCurrentLocation(null);
        return;
      }

      const { data, error } = await supabase
        .from('locations')
        .select('id,name,address,city,postal_code,country,formatted_address')
        .eq('id', currentLocationId)
        .maybeSingle();

      if (!alive) return;

      if (error) {
        console.error('Fetch current location error:', error);
        setCurrentLocation(null);
        return;
      }

      setCurrentLocation((data as LocationRow) || null);
    };

    run();
    return () => {
      alive = false;
    };
  }, [currentLocationId]);

  // click outside closes dropdown
  useEffect(() => {
    if (!editMode) return;

    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };

    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [editMode]);

  // set input from selected location when not typing
  useEffect(() => {
    if (!editMode) return;
    if (isUserTyping) return;
    setQ(labelForInput(currentLocation)); // ✅ tylko nazwa
  }, [editMode, currentLocation, isUserTyping]);

  // debounce search
  useEffect(() => {
    if (!editMode) return;

    const t = setTimeout(async () => {
      const query = q.trim();

      if (query.length < 2) {
        setSuggestions([]);
        setLoading(false);
        if (isUserTyping) setFetchError('');
        return;
      }

      try {
        setLoading(true);

        const v = quoteForOrIlike(query);

        const { data, error } = await supabase
          .from('locations')
          .select('id,name,address,city,postal_code,country,formatted_address')
          .or(`name.ilike.${v},address.ilike.${v},city.ilike.${v},formatted_address.ilike.${v}`)
          .order('name', { ascending: true })
          .limit(20);

        if (error) throw error;

        setSuggestions((data as LocationRow[]) || []);
        setFetchError('');
      } catch (e: any) {
        console.error('Search locations error:', e);
        setSuggestions([]);
        setFetchError('Nie udało się pobrać lokalizacji');
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [q, editMode, isUserTyping]);

  const handlePick = (loc: LocationRow) => {
    setFetchError('');
    setIsUserTyping(false);

    onLocationChange(loc.id);
    setCurrentLocation(loc);

    setQ(labelForInput(loc)); // ✅ tylko nazwa
    setOpen(false);
    setSuggestions([]);
    setLoading(false);

    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const clearSelection = () => {
    setFetchError('');
    setIsUserTyping(true);

    onLocationChange(null);
    setCurrentLocation(null);

    setQ('');
    setSuggestions([]);
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // VIEW MODE: link
  if (!editMode) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="text-sm font-medium text-white/80">Lokalizacja</div>

        <div className="mt-2">
          {currentLocationId && currentLocation ? (
            <Link
              href={`/crm/locations/${currentLocationId}`}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/90 transition hover:border-[#d3bb73]/40 hover:bg-black/30"
            >
              <span className="truncate">{labelForInput(currentLocation) || '—'}</span>
            </Link>
          ) : (
            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/50">
              Brak przypisanej lokalizacji
            </div>
          )}
        </div>
      </div>
    );
  }

  const showError = isUserTyping && !!fetchError;

  return (
    <div ref={rootRef} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="text-sm font-medium text-white/80">Lokalizacja</div>

      <div className="mt-3 flex items-stretch gap-3">
        <div className="relative flex-1">
          {/* ✅ ikona lupy idealnie w pionie */}
          <Search className="pointer-events-none absolute left-3 top-[22px] h-4 w-4 -translate-y-1/2 text-white/40" />

          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setIsUserTyping(true);
              setFetchError('');
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Wpisz min. 2 znaki…"
            className={[
              // ✅ stała wysokość inputa -> ikony zawsze trafiają w środek
              'h-11 w-full rounded-lg border bg-black/20 py-2 pl-10 pr-10 text-sm text-white outline-none transition',
              showError ? 'border-red-500/50' : 'border-white/10 focus:border-[#d3bb73]/40',
            ].join(' ')}
          />

          {q && (
            <button
              type="button"
              onClick={clearSelection}
              className="absolute right-2 top-[22px] -translate-y-1/2 rounded-md p-2 text-white/40 transition hover:bg-white/5 hover:text-white/80"
              aria-label="Wyczyść"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {open && q.trim().length >= 2 && (
            <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-lg border border-white/10 bg-[#0f1119] shadow-2xl">
              {loading ? (
                <div className="px-4 py-3 text-sm text-white/60">Szukam…</div>
              ) : suggestions.length === 0 ? (
                <div className="px-4 py-3 text-sm text-white/60">
                  Brak wyników. Możesz dodać nową lokalizację.
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  {suggestions.map((loc) => (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => handlePick(loc)}
                      className="w-full border-b border-white/5 px-4 py-3 text-left text-sm text-white/90 transition hover:bg-white/5"
                    >
                      <div className="font-medium">{suggestionTitle(loc)}</div>
                      <div className="mt-0.5 text-xs text-white/50">{suggestionSub(loc)}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mt-1 text-xs text-white/40">
            Wpisz min. 2 znaki — pokaże się podpowiedź. Jeśli nie ma na liście, dodaj nową
            lokalizację.
          </div>

          {showError && (
            <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {fetchError}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => onOpenAddLocation?.()}
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#d3bb73] px-4 text-sm font-semibold text-[#0f1119] transition hover:bg-[#c4a859]"
        >
          <Plus className="h-4 w-4" />
          Dodaj nową lokalizację
        </button>
      </div>
    </div>
  );
}