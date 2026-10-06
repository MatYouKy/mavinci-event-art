'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { ExternalLink, Upload } from 'lucide-react';
import { ImageDropzone } from '@/components/UI/ImageDropzone';
import { supabase } from '@/lib/supabase/browser';
import type { SellerBranding } from '@/lib/seller/portal';
import OfferHeadingFontPicker, { sellerUploadedFonts } from './OfferHeadingFontPicker';

export type IdentityAssetKind = 'portrait' | 'logo' | 'cover' | 'venue' | 'brandbook' | 'heading-font';
export const identityFieldClass = 'w-full rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/40 disabled:opacity-60';

function useAssetUrl(path?: string | null) {
  const [resolved, setResolved] = useState<{ path: string; url: string } | null>(null);
  useEffect(() => {
    let active = true;
    if (!path) { setResolved(null); return; }
    if (/^https?:\/\//i.test(path)) { setResolved({ path, url: path }); return; }
    void supabase.storage.from('seller-brand-assets').createSignedUrl(path, 3600).then(({ data }) => {
      if (active) setResolved({ path, url: data?.signedUrl || '' });
    }).catch(() => {
      if (active) setResolved({ path, url: '' });
    });
    return () => { active = false; };
  }, [path]);
  // When both paths are undefined, optional chaining alone compares them as
  // equal even though resolved is still null (e.g. an organization without a logo).
  return resolved && resolved.path === path ? resolved.url : '';
}

export function IdentityAssetPreview({ path, alt, fit = 'contain', className = 'h-40' }: { path?: string | null; alt: string; fit?: 'contain' | 'cover'; className?: string }) {
  const url = useAssetUrl(path);
  const [failed, setFailed] = useState('');
  return <div className={`relative overflow-hidden rounded-lg bg-black/15 ${className}`}>
    {url && url !== failed ? <Image src={url} alt={alt} fill unoptimized className={fit === 'cover' ? 'object-cover' : 'object-contain'} onError={() => setFailed(url)} /> : <span className="flex h-full items-center justify-center px-3 text-center text-xs text-white/35">{path ? 'Podgląd niedostępny' : 'Brak pliku'}</span>}
  </div>;
}

function AssetLink({ path, label }: { path?: string | null; label: string }) {
  const url = useAssetUrl(path);
  return url ? <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-[#d3bb73] hover:underline"><ExternalLink className="h-3 w-3" />{label}</a> : null;
}

export async function uploadIdentityAssets({ files, kind, companyId, partnerId, organizationId, galleryCount = 0, fontCount = 0 }: {
  files: File[]; kind: IdentityAssetKind; companyId: string; partnerId?: string; organizationId?: string | null; galleryCount?: number; fontCount?: number;
}): Promise<string[]> {
  if (!companyId || (!partnerId && !organizationId)) throw new Error('Wybierz markę i właściciela plików.');
  if (kind === 'portrait' && !partnerId) throw new Error('Zdjęcie wymaga powiązania ze sprzedawcą.');
  const selected = kind === 'venue' ? files : files.slice(0, 1);
  if (kind === 'venue' && selected.length + galleryCount > 24) throw new Error('Galeria może zawierać maksymalnie 24 zdjęcia.');
  if (kind === 'heading-font' && fontCount >= 24) throw new Error('Branding może zawierać maksymalnie 24 własne czcionki.');
  for (const file of selected) {
    if (!file.size || file.size > (kind === 'brandbook' ? 20 : 10) * 1024 * 1024) throw new Error(`Plik „${file.name}” jest pusty lub przekracza limit ${kind === 'brandbook' ? 20 : 10} MB.`);
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (kind === 'heading-font') {
      const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      const signature = String.fromCharCode(...header);
      if (!['ttf', 'otf', 'woff', 'woff2'].includes(extension) || !(header.join(',') === '0,1,0,0' || ['OTTO', 'wOFF', 'wOF2'].includes(signature))) throw new Error('Wybierz prawidłowy plik czcionki TTF, OTF, WOFF lub WOFF2.');
    } else if (kind === 'brandbook') {
      if (extension !== 'pdf' || await file.slice(0, 5).text() !== '%PDF-') throw new Error('Brandbook musi być plikiem PDF.');
    } else if (!['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(extension)) {
      throw new Error('Wgraj zdjęcie lub logo jako PNG, JPG lub WEBP (nie SVG).');
    }
  }
  const root = kind === 'portrait' || !organizationId ? `${partnerId}/${companyId}` : `organizations/${organizationId}/${companyId}`;
  const paths: string[] = [];
  for (const file of selected) {
    const path = `${root}/${kind}-${crypto.randomUUID()}.${file.name.split('.').pop()!.toLowerCase()}`;
    const { error } = await supabase.storage.from('seller-brand-assets').upload(path, file, { upsert: false });
    if (error) throw new Error('Nie udało się wgrać pliku. Sprawdź uprawnienia do organizacji i marki.');
    paths.push(path);
  }
  return paths;
}

export function identityAssetPatch(kind: IdentityAssetKind, paths: string[], current: SellerBranding, files?: File[]): Partial<SellerBranding> {
  if (!paths.length) return {};
  if (kind === 'venue') return { venue_image_urls: [...(current.venue_image_urls || []), ...paths] };
  if (kind === 'heading-font') {
    const family = files?.[0]?.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 200) || 'Wgrana czcionka';
    return { heading_font_path: paths[0], heading_font_family: family, heading_font_catalog_id: null,
      heading_font_uploads: [...sellerUploadedFonts(current), { family, path: paths[0] }] };
  }
  const field = { portrait: 'portrait_url', logo: 'hotel_logo_url', cover: 'hotel_cover_image_url', brandbook: 'brandbook_url' }[kind];
  return { [field]: paths[0] };
}

type Props = {
  value: SellerBranding;
  companyId?: string;
  onChange: (patch: Partial<SellerBranding>) => void;
  onUpload: (files: File[], kind: IdentityAssetKind) => void | Promise<void>;
  disabled?: boolean;
  uploading?: IdentityAssetKind | null;
};

export function SellerPersonalIdentityFields({ value, onChange, onUpload, disabled = false, uploading }: Props) {
  return <section className="grid gap-5 rounded-xl bg-[#1c1f33] p-5 md:grid-cols-2">
    <div className="space-y-3"><h2 className="text-sm font-medium">Wizytówka sprzedawcy</h2><p className="text-xs leading-5 text-white/45">Zdjęcie i dane tej osoby są podstawiane do części kontaktowej oferty. Nie zmieniają danych innych sprzedawców.</p>
      {([{ key: 'display_name', label: 'Imię i nazwisko' }, { key: 'position_title', label: 'Stanowisko' }, { key: 'contact_email', label: 'E-mail' }, { key: 'contact_phone', label: 'Telefon' }] as const).map((field) => <label key={field.key} className="block text-xs text-white/50">{field.label}<input type={field.key === 'contact_email' ? 'email' : 'text'} value={value[field.key] || ''} disabled={disabled} maxLength={200} onChange={(event) => onChange({ [field.key]: event.target.value })} className={`${identityFieldClass} mt-1.5`} /></label>)}
    </div>
    <div><h2 className="text-sm font-medium">Zdjęcie sprzedawcy</h2><div className="mt-3"><ImageDropzone onFiles={(files) => onUpload(files, 'portrait')} busy={uploading === 'portrait'} disabled={disabled} label="Przeciągnij zdjęcie sprzedawcy" className="h-64" preview={value.portrait_url ? <IdentityAssetPreview path={value.portrait_url} alt="Zdjęcie sprzedawcy" className="h-full w-full" /> : undefined} /></div></div>
  </section>;
}

export function OfferVisualIdentityFields({ value, onChange, onUpload, disabled = false, uploading, companyId }: Props) {
  return <div className="space-y-5">
    <section className="grid gap-5 rounded-xl bg-[#1c1f33] p-5 md:grid-cols-2">
      {([{ key: 'hotel_logo_url', kind: 'logo', label: 'Logo organizacji / marki', fit: 'contain' }, { key: 'hotel_cover_image_url', kind: 'cover', label: 'Zdjęcie okładkowe obiektu', fit: 'cover' }] as const).map((asset) => <div key={asset.key}><h3 className="text-sm font-medium">{asset.label}</h3><div className="mt-3"><ImageDropzone onFiles={(files) => onUpload(files, asset.kind)} busy={uploading === asset.kind} disabled={disabled} label={`Przeciągnij: ${asset.label.toLocaleLowerCase('pl-PL')}`} className="h-48" preview={value[asset.key] ? <IdentityAssetPreview path={value[asset.key]} alt={asset.label} fit={asset.fit} className="h-full w-full" /> : undefined} /></div>{value[asset.key] && <button type="button" disabled={disabled} onClick={() => onChange({ [asset.key]: '' })} className="mt-2 text-xs text-white/45 hover:text-red-300">Usuń z ustawień</button>}</div>)}
      <div className="md:col-span-2"><h3 className="text-sm font-medium">Galeria obiektu</h3><div className="mt-3 grid gap-3 sm:grid-cols-3">{(value.venue_image_urls || []).map((path, index) => <div key={`${path}-${index}`}><IdentityAssetPreview path={path} alt={`Galeria obiektu ${index + 1}`} className="h-28" /><button type="button" disabled={disabled} onClick={() => onChange({ venue_image_urls: (value.venue_image_urls || []).filter((_, i) => i !== index) })} className="mt-2 text-xs text-white/45 hover:text-red-300">Usuń z galerii</button></div>)}<ImageDropzone onFiles={(files) => onUpload(files, 'venue')} disabled={disabled || (value.venue_image_urls?.length || 0) >= 24} busy={uploading === 'venue'} multiple label="Przeciągnij zdjęcia do galerii" className="h-28" /></div></div>
    </section>
    <section className="space-y-5 rounded-xl bg-[#1c1f33] p-5">
      <h3 className="text-sm font-medium">Kolory szablonu PDF</h3><p className="text-xs leading-5 text-white/45">Zachowujemy układ oferty CRM. Kolor główny zastępuje bordo, akcent — złote elementy. Tło dotyczy jasnych stron dokumentu.</p>
      <OfferBrandColorFields value={value} onChange={onChange} disabled={disabled} />
    </section>
    <section className="grid gap-5 rounded-xl bg-[#1c1f33] p-5 md:grid-cols-2">
      <div className="space-y-3"><h3 className="text-sm font-medium">Czcionka nagłówków</h3><OfferHeadingFontPicker key={companyId || 'no-brand'} companyId={companyId} value={value} onChange={onChange} disabled={disabled || !companyId} />
        <label className={`flex items-center justify-center gap-2 rounded-lg bg-white/5 p-4 text-xs text-[#d3bb73] ${disabled ? 'opacity-40' : 'cursor-pointer'}`}><Upload className="h-4 w-4" />{uploading === 'heading-font' ? 'Wgrywanie czcionki…' : 'Wgraj własną czcionkę'}<input type="file" accept=".ttf,.otf,.woff,.woff2" disabled={disabled} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void onUpload([file], 'heading-font'); }} /></label>
        <p className="text-xs leading-5 text-white/40">TTF, OTF, WOFF lub WOFF2, do 10 MB — z prawem osadzania w PDF. Wgrane fonty zostają na liście tego brandingu także po zmianie wyboru. Atom zawsze wyświetlamy wielkimi literami.</p>
        {value.heading_font_path && <AssetLink path={value.heading_font_path} label="Zapisany plik czcionki" />}
      </div>
      <div className="space-y-3"><h3 className="text-sm font-medium">Brandbook</h3><label className={`flex items-center justify-center gap-2 rounded-lg bg-white/5 p-4 text-xs text-[#d3bb73] ${disabled ? 'opacity-40' : 'cursor-pointer'}`}><Upload className="h-4 w-4" />{uploading === 'brandbook' ? 'Wgrywanie…' : 'Wgraj brandbook PDF'}<input type="file" accept="application/pdf" disabled={disabled} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void onUpload([file], 'brandbook'); }} /></label><AssetLink path={value.brandbook_url} label="Otwórz brandbook" />
        <label className="block text-xs text-white/50">Zasady używania marki<textarea value={value.brandbook_notes || ''} disabled={disabled} maxLength={2000} rows={3} onChange={(event) => onChange({ brandbook_notes: event.target.value })} className={`${identityFieldClass} mt-1.5`} /></label><p className="text-xs leading-5 text-white/40">PDF brandbooka jest instrukcją dla opiekuna — nie odczytujemy z niego automatycznie ustawień. Wgraj osobno logotyp i zdjęcia, ustaw kolory oraz wybierz czcionkę z plikiem. Te zasoby tworzą wygląd oferty; sam PDF nie wystarczy.</p>
      </div>
    </section>
    <section className="grid gap-4 rounded-xl bg-[#1c1f33] p-5 md:grid-cols-2">{([{ key: 'footer_text', label: 'Tekst organizacji w ofercie', placeholder: 'Adres, strona WWW, dane organizacji' }, { key: 'disclosure_text', label: 'Informacja o partnerze / realizatorze', placeholder: 'Opcjonalna informacja formalna' }] as const).map((field) => <label key={field.key} className="text-xs text-white/50">{field.label}<textarea rows={3} maxLength={1000} value={value[field.key] || ''} disabled={disabled} onChange={(event) => onChange({ [field.key]: event.target.value })} className={`${identityFieldClass} mt-1.5`} placeholder={field.placeholder} /></label>)}</section>
  </div>;
}

export function OrganizationIdentitySummary({ value, name }: { value: SellerBranding; name?: string | null }) {
  return <section className="rounded-xl bg-[#1c1f33] p-5"><h2 className="text-sm font-medium">Branding organizacji{ name ? ` · ${name}` : ''}</h2><p className="mt-2 text-xs leading-5 text-white/50">Logo, zdjęcia obiektu, kolory i czcionkę ustawia opiekun w CRM. Dziedziczysz je automatycznie — uzupełnij tylko swoją wizytówkę.</p>
    <div className="mt-4 grid items-center gap-4 sm:grid-cols-[180px_1fr]"><IdentityAssetPreview path={value.hotel_logo_url} alt="Logo organizacji" className="h-24" /><div className="space-y-3"><p className="text-xs text-white/60">Czcionka nagłówków: {value.heading_font_family || 'Noto Sans'}</p><div className="flex flex-wrap gap-3">{[value.brand_primary_color, value.brand_secondary_color, value.brand_surface_color].filter(Boolean).map((color, index) => <span key={index} className="flex items-center gap-2 text-xs text-white/50"><span className="h-5 w-5 rounded-full" style={{ backgroundColor: color! }} />{color}</span>)}</div><AssetLink path={value.brandbook_url} label="Brandbook organizacji" /></div></div>
    {value.organization_branding_configured === false && <p className="mt-3 text-xs text-amber-200">Organizacja nie ma jeszcze ustawionego brandingu tej marki. Poproś opiekuna o jego uzupełnienie.</p>}
  </section>;
}

export function OfferBrandColorFields({ value, onChange, disabled = false }: { value: Partial<SellerBranding>; onChange: (patch: Partial<SellerBranding>) => void; disabled?: boolean }) {
  return <div className="grid gap-4 sm:grid-cols-3">{([{ key: 'brand_primary_color', label: 'Kolor główny', fallback: '#1c1f33' }, { key: 'brand_secondary_color', label: 'Akcent', fallback: '#d3bb73' }, { key: 'brand_surface_color', label: 'Tło jasnych stron', fallback: '#faf7f2' }] as const).map((color) => <label key={color.key} className="text-xs text-white/50">{color.label}<input type="color" value={value[color.key] || color.fallback} disabled={disabled} onChange={(event) => onChange({ [color.key]: event.target.value })} className="mt-2 h-11 w-full cursor-pointer rounded-lg bg-black/15 p-1" /><span className="mt-1 block">{value[color.key] || color.fallback}</span></label>)}</div>;
}
