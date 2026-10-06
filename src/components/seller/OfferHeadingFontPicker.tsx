'use client';

import { useEffect, useMemo, useState } from 'react';
import SearchCombobox, { type SearchComboboxOption } from '@/components/crm/SearchCombobox';
import { SYSTEM_FONTS } from '@/lib/CRM/systemFonts';
import { supabase } from '@/lib/supabase/browser';
import type { SellerBranding } from '@/lib/seller/portal';

type CatalogFont = { id: string; label: string; family: string; weight: string | null; file_url: string | null; storage_path: string | null };
type FontOption = SearchComboboxOption & { family: string; path?: string; catalogId?: string; uploaded: boolean; rank: number };
const normalize = (family: string) => family.split(',')[0].replace(/["']/g, '').trim().toLocaleLowerCase('pl-PL');

export function sellerUploadedFonts(value: SellerBranding) {
  const uploads = [...(value.heading_font_uploads || [])];
  if (value.heading_font_path && !uploads.some((font) => font.path === value.heading_font_path)) {
    uploads.push({ family: value.heading_font_family || 'Wgrana czcionka', path: value.heading_font_path });
  }
  return uploads.filter((font, index) => font.path && uploads.findIndex((item) => item.path === font.path) === index);
}

export default function OfferHeadingFontPicker({ value, onChange, disabled = false, companyId }: {
  value: SellerBranding; onChange: (patch: Partial<SellerBranding>) => void; disabled?: boolean; companyId?: string;
}) {
  const [fonts, setFonts] = useState<CatalogFont[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    if (!companyId) { setFonts([]); setLoading(false); return; }
    // Use the CRM catalog within the selected brand, preserving existing RLS.
    void (async () => {
      try {
        const { data, error: failed } = await supabase.from('company_brandbook_fonts')
          .select('id,label,family,weight,file_url,storage_path').eq('company_id', companyId).order('order_index');
        if (failed) throw failed;
        if (active) setFonts(data || []);
      } catch { if (active) setError('Nie udało się pobrać biblioteki czcionek CRM. Zapisany wybór nie został zmieniony.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [attempt, companyId]);

  const options = useMemo(() => {
    const uploaded: FontOption[] = sellerUploadedFonts(value).map((font) => ({
      id: `upload:${font.path}`, label: font.family, family: font.family, path: font.path,
      uploaded: true, rank: 0, description: 'Wgrana do tego brandingu · plik do PDF',
    }));
    const catalog: FontOption[] = fonts.map((font) => {
      const hasFile = Boolean(font.file_url || font.storage_path);
      return { id: `crm:${font.id}`, label: font.label && font.label !== font.family ? `${font.family} — ${font.label}` : font.family,
        family: font.family, catalogId: font.id, uploaded: hasFile, rank: hasFile ? 1 : 3,
        description: `${hasFile ? 'Wgrana w CRM' : 'Biblioteka CRM · wymaga pliku do PDF'}${font.weight ? ` · grubość ${font.weight}` : ''}` };
    });
    const system: FontOption[] = SYSTEM_FONTS.map((font) => ({ ...font, id: `system:${font.family}`,
      uploaded: false, rank: 4, description: 'Czcionka systemowa CRM · wymaga pliku do PDF' }));
    const all: FontOption[] = [...uploaded, ...catalog,
      { id: 'builtin:noto-sans', label: 'Noto Sans', family: 'Noto Sans', uploaded: false, rank: 2, description: 'Wbudowana w generator PDF' }, ...system];
    if (value.heading_font_catalog_id && !catalog.some((font) => font.catalogId === value.heading_font_catalog_id)) {
      all.push({ id: `crm:${value.heading_font_catalog_id}`, catalogId: value.heading_font_catalog_id,
        family: value.heading_font_family || 'Zapisana czcionka', label: value.heading_font_family || 'Zapisana czcionka',
        uploaded: false, rank: 3, description: loading ? 'Wczytywanie biblioteki…' : 'Zapisany wybór · brak w dostępnej bibliotece' });
    } else if (!value.heading_font_path && !value.heading_font_catalog_id && value.heading_font_family
        && normalize(value.heading_font_family) !== 'noto sans' && !system.some((font) => font.family === value.heading_font_family)) {
      all.push({ id: `system:${value.heading_font_family}`, label: value.heading_font_family, family: value.heading_font_family,
        uploaded: false, rank: 4, description: 'Zapisana nazwa · wymaga pliku do PDF' });
    }
    return all.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'pl'));
  }, [fonts, value, loading]);
  const selectedId = value.heading_font_path ? `upload:${value.heading_font_path}`
    : value.heading_font_catalog_id ? `crm:${value.heading_font_catalog_id}`
    : !value.heading_font_family || normalize(value.heading_font_family) === 'noto sans' ? 'builtin:noto-sans'
    : `system:${value.heading_font_family}`;
  const selected = options.find((font) => font.id === selectedId);
  const missingFile = selected && !selected.uploaded && normalize(selected.family) !== 'noto sans';

  return <div className="space-y-2">
    <p className="text-xs text-white/50">Wybierz lub wyszukaj czcionkę</p>
    <SearchCombobox value={selectedId} options={options} disabled={disabled} allowClear={false}
      ariaLabel="Czcionka nagłówków" placeholder="Wpisz nazwę czcionki…" emptyLabel="Brak pasującej czcionki. Możesz wgrać własny plik poniżej."
      onChange={(id) => {
        const font = options.find((option) => option.id === id);
        if (font) onChange({ heading_font_family: font.family, heading_font_path: font.path || '',
          heading_font_catalog_id: font.catalogId || null, heading_font_uploads: sellerUploadedFonts(value) });
      }} />
    <p className="text-xs leading-5 text-white/40">Najpierw własne pliki i czcionki wgrane w CRM dla wybranej marki, potem pozostałe czcionki z edytora. Listę możesz przewijać.</p>
    {loading && <p role="status" className="text-xs text-white/40">Wczytywanie czcionek CRM…</p>}
    {error && <p role="alert" className="text-xs text-amber-200">{error} <button type="button" disabled={loading} onClick={() => setAttempt((current) => current + 1)} className="underline underline-offset-4">Ponów</button></p>}
    {missingFile && <p className="rounded-lg bg-amber-300/5 p-3 text-xs leading-5 text-amber-200">Ten wybór nie ma pliku do osadzenia w PDF. Wgraj font z prawem osadzania albo wybierz pozycję oznaczoną „Wgrana”. Nie zastąpimy go automatycznie inną czcionką.</p>}
  </div>;
}
