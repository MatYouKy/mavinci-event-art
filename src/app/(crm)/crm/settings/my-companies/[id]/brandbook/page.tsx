'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Image as ImageIcon,
  Palette,
  Type,
  Sliders,
  Plus,
  Trash2,
  Upload,
  Star,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';

const LOGOS_BUCKET = 'company-logos';

interface CompanySummary {
  id: string;
  name: string;
  legal_name: string;
}

interface BrandbookLogo {
  id: string;
  company_id: string;
  label: string;
  url: string;
  variant: string;
  background: string;
  order_index: number;
  is_default: boolean;
}

interface BrandbookColor {
  id: string;
  company_id: string;
  label: string;
  hex: string;
  role: string;
  order_index: number;
}

interface BrandbookFont {
  id: string;
  company_id: string;
  label: string;
  family: string;
  weight: string;
  role: string;
  order_index: number;
}

interface BrandbookStyle {
  id: string;
  company_id: string;
  key: string;
  value: string;
  description: string;
  order_index: number;
}

type TabKey = 'logos' | 'colors' | 'fonts' | 'styles';

const COLOR_ROLES = [
  { value: 'primary', label: 'Primary' },
  { value: 'secondary', label: 'Secondary' },
  { value: 'accent', label: 'Accent' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'success', label: 'Success' },
  { value: 'warning', label: 'Warning' },
  { value: 'error', label: 'Error' },
];

const FONT_ROLES = [
  { value: 'heading', label: 'Nagłówki' },
  { value: 'body', label: 'Tekst' },
  { value: 'mono', label: 'Mono' },
];

const LOGO_VARIANTS = [
  { value: 'default', label: 'Podstawowy' },
  { value: 'horizontal', label: 'Poziomy' },
  { value: 'vertical', label: 'Pionowy' },
  { value: 'icon', label: 'Sygnet' },
  { value: 'monochrome', label: 'Monochromatyczny' },
];

const LOGO_BACKGROUNDS = [
  { value: 'light', label: 'Jasne tło' },
  { value: 'dark', label: 'Ciemne tło' },
  { value: 'transparent', label: 'Transparent' },
];

function publicLogoUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${LOGOS_BUCKET}/${path}`;
}

export default function CompanyBrandbookPage() {
  const params = useParams<{ id: string }>();
  const companyId = params?.id as string;
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  const [company, setCompany] = useState<CompanySummary | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('logos');
  const [loading, setLoading] = useState(true);

  const [logos, setLogos] = useState<BrandbookLogo[]>([]);
  const [colors, setColors] = useState<BrandbookColor[]>([]);
  const [fonts, setFonts] = useState<BrandbookFont[]>([]);
  const [styles, setStyles] = useState<BrandbookStyle[]>([]);

  const loadAll = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [companyRes, logosRes, colorsRes, fontsRes, stylesRes] = await Promise.all([
        supabase
          .from('my_companies')
          .select('id, name, legal_name')
          .eq('id', companyId)
          .maybeSingle(),
        supabase
          .from('company_brandbook_logos')
          .select('*')
          .eq('company_id', companyId)
          .order('order_index'),
        supabase
          .from('company_brandbook_colors')
          .select('*')
          .eq('company_id', companyId)
          .order('order_index'),
        supabase
          .from('company_brandbook_fonts')
          .select('*')
          .eq('company_id', companyId)
          .order('order_index'),
        supabase
          .from('company_brandbook_styles')
          .select('*')
          .eq('company_id', companyId)
          .order('order_index'),
      ]);

      if (companyRes.error) throw companyRes.error;
      if (!companyRes.data) {
        showSnackbar('Nie znaleziono firmy', 'error');
        router.push('/crm/settings/my-companies');
        return;
      }
      setCompany(companyRes.data as CompanySummary);
      setLogos((logosRes.data as BrandbookLogo[]) ?? []);
      setColors((colorsRes.data as BrandbookColor[]) ?? []);
      setFonts((fontsRes.data as BrandbookFont[]) ?? []);
      setStyles((stylesRes.data as BrandbookStyle[]) ?? []);
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd ładowania brandbooka', 'error');
    } finally {
      setLoading(false);
    }
  }, [companyId, router, showSnackbar]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d1a]">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="mx-auto max-w-6xl">
        <button
          onClick={() => router.push('/crm/settings/my-companies')}
          className="mb-4 flex items-center gap-2 text-sm text-[#e5e4e2]/60 hover:text-[#d3bb73]"
        >
          <ArrowLeft className="h-4 w-4" />
          Wróć do listy firm
        </button>

        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-light text-[#e5e4e2]">Brandbook</h1>
          <p className="text-[#e5e4e2]/60">
            {company?.name} <span className="text-[#e5e4e2]/40">/ {company?.legal_name}</span>
          </p>
        </div>

        <div className="mb-6 flex gap-2 border-b border-[#d3bb73]/10">
          {(
            [
              { key: 'logos', label: 'Logotypy', icon: ImageIcon },
              { key: 'colors', label: 'Kolory', icon: Palette },
              { key: 'fonts', label: 'Fonty', icon: Type },
              { key: 'styles', label: 'Style', icon: Sliders },
            ] as { key: TabKey; label: string; icon: typeof ImageIcon }[]
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm transition-colors ${
                  active
                    ? 'border-[#d3bb73] text-[#d3bb73]'
                    : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === 'logos' && (
          <LogosPanel
            companyId={companyId}
            logos={logos}
            onChange={setLogos}
            reload={loadAll}
          />
        )}
        {activeTab === 'colors' && (
          <ColorsPanel companyId={companyId} colors={colors} onChange={setColors} reload={loadAll} />
        )}
        {activeTab === 'fonts' && (
          <FontsPanel companyId={companyId} fonts={fonts} onChange={setFonts} reload={loadAll} />
        )}
        {activeTab === 'styles' && (
          <StylesPanel companyId={companyId} styles={styles} onChange={setStyles} reload={loadAll} />
        )}
      </div>
    </div>
  );
}

function LogosPanel({
  companyId,
  logos,
  onChange,
  reload,
}: {
  companyId: string;
  logos: BrandbookLogo[];
  onChange: (next: BrandbookLogo[]) => void;
  reload: () => Promise<void>;
}) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showSnackbar('Plik musi być obrazem', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showSnackbar('Maksymalny rozmiar pliku to 5MB', 'error');
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const path = `brandbook/${companyId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(LOGOS_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from('company_brandbook_logos').insert({
        company_id: companyId,
        label: file.name.replace(/\.[^.]+$/, ''),
        url: path,
        variant: 'default',
        background: 'light',
        order_index: logos.length,
        is_default: logos.length === 0,
      });
      if (insErr) throw insErr;

      showSnackbar('Logo dodane', 'success');
      await reload();
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd uploadu logo', 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const updateLogo = async (logo: BrandbookLogo, patch: Partial<BrandbookLogo>) => {
    const next = logos.map((l) => (l.id === logo.id ? { ...l, ...patch } : l));
    onChange(next);
    const { error } = await supabase
      .from('company_brandbook_logos')
      .update(patch)
      .eq('id', logo.id);
    if (error) {
      showSnackbar(error.message || 'Błąd zapisu', 'error');
      await reload();
    }
  };

  const setDefault = async (logo: BrandbookLogo) => {
    const next = logos.map((l) => ({ ...l, is_default: l.id === logo.id }));
    onChange(next);
    const { error } = await supabase
      .from('company_brandbook_logos')
      .update({ is_default: false })
      .eq('company_id', companyId);
    if (error) {
      showSnackbar(error.message || 'Błąd ustawiania domyślnego', 'error');
      await reload();
      return;
    }
    await supabase
      .from('company_brandbook_logos')
      .update({ is_default: true })
      .eq('id', logo.id);
    showSnackbar('Logo ustawione jako domyślne', 'success');
  };

  const removeLogo = async (logo: BrandbookLogo) => {
    const ok = await showConfirm({
      title: 'Usuń logo',
      message: 'Czy na pewno chcesz usunąć to logo?',
      confirmText: 'Usuń',
      cancelText: 'Anuluj',
    });
    if (!ok) return;
    try {
      await supabase.storage.from(LOGOS_BUCKET).remove([logo.url]);
      const { error } = await supabase
        .from('company_brandbook_logos')
        .delete()
        .eq('id', logo.id);
      if (error) throw error;
      showSnackbar('Logo usunięte', 'success');
      await reload();
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd usuwania', 'error');
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[#e5e4e2]/60">
          Logotypy dostępne jako placeholder <code className="text-[#d3bb73]">{`{{company_logo}}`}</code>
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          {uploading ? 'Przesyłanie...' : 'Dodaj logo'}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {logos.map((logo) => (
          <div
            key={logo.id}
            className={`rounded-xl border bg-[#1c1f33] p-4 ${
              logo.is_default ? 'border-[#d3bb73]' : 'border-[#d3bb73]/10'
            }`}
          >
            <div
              className={`mb-3 flex h-32 items-center justify-center overflow-hidden rounded-lg p-3 ${
                logo.background === 'dark'
                  ? 'bg-[#1c1f33]'
                  : logo.background === 'transparent'
                    ? 'bg-[repeating-conic-gradient(#1c1f33_0_25%,#0a0d1a_0_50%)] bg-[length:16px_16px]'
                    : 'bg-white'
              }`}
            >
              <img
                src={publicLogoUrl(logo.url)}
                alt={logo.label}
                className="max-h-full max-w-full object-contain"
              />
            </div>

            <div className="space-y-2">
              <input
                type="text"
                value={logo.label}
                onChange={(e) => updateLogo(logo, { label: e.target.value })}
                placeholder="Nazwa"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-1.5 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={logo.variant}
                  onChange={(e) => updateLogo(logo, { variant: e.target.value })}
                  className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-1.5 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                >
                  {LOGO_VARIANTS.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <select
                  value={logo.background}
                  onChange={(e) => updateLogo(logo, { background: e.target.value })}
                  className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-1.5 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                >
                  {LOGO_BACKGROUNDS.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  onClick={() => setDefault(logo)}
                  disabled={logo.is_default}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs ${
                    logo.is_default
                      ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                      : 'text-[#e5e4e2]/60 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]'
                  }`}
                >
                  <Star className={`h-3 w-3 ${logo.is_default ? 'fill-current' : ''}`} />
                  {logo.is_default ? 'Domyślne' : 'Ustaw jako domyślne'}
                </button>
                <button
                  onClick={() => removeLogo(logo)}
                  className="rounded-lg p-1.5 text-[#e5e4e2]/60 hover:bg-red-400/10 hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <code className="block truncate text-[10px] text-[#e5e4e2]/40" title={logo.url}>
                {publicLogoUrl(logo.url)}
              </code>
            </div>
          </div>
        ))}

        {logos.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-[#d3bb73]/20 bg-[#1c1f33] p-8 text-center">
            <ImageIcon className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/20" />
            <p className="text-sm text-[#e5e4e2]/60">Brak logotypów - dodaj pierwszy logotyp powyżej</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ColorsPanel({
  companyId,
  colors,
  onChange,
  reload,
}: {
  companyId: string;
  colors: BrandbookColor[];
  onChange: (next: BrandbookColor[]) => void;
  reload: () => Promise<void>;
}) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  const addColor = async () => {
    const { error } = await supabase.from('company_brandbook_colors').insert({
      company_id: companyId,
      label: 'Nowy kolor',
      hex: '#d3bb73',
      role: 'primary',
      order_index: colors.length,
    });
    if (error) {
      showSnackbar(error.message || 'Błąd dodawania koloru', 'error');
      return;
    }
    await reload();
  };

  const updateColor = async (color: BrandbookColor, patch: Partial<BrandbookColor>) => {
    const next = colors.map((c) => (c.id === color.id ? { ...c, ...patch } : c));
    onChange(next);
    const { error } = await supabase
      .from('company_brandbook_colors')
      .update(patch)
      .eq('id', color.id);
    if (error) {
      showSnackbar(error.message || 'Błąd zapisu', 'error');
      await reload();
    }
  };

  const removeColor = async (color: BrandbookColor) => {
    const ok = await showConfirm({
      title: 'Usuń kolor',
      message: `Czy na pewno chcesz usunąć kolor "${color.label}"?`,
      confirmText: 'Usuń',
      cancelText: 'Anuluj',
    });
    if (!ok) return;
    const { error } = await supabase
      .from('company_brandbook_colors')
      .delete()
      .eq('id', color.id);
    if (error) {
      showSnackbar(error.message || 'Błąd usuwania', 'error');
      return;
    }
    await reload();
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[#e5e4e2]/60">
          Kolory dostępne jako <code className="text-[#d3bb73]">{`{{brand_primary_color}}`}</code>,{' '}
          <code className="text-[#d3bb73]">{`{{brand_secondary_color}}`}</code>,{' '}
          <code className="text-[#d3bb73]">{`{{brand_accent_color}}`}</code>
        </p>
        <button
          onClick={addColor}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Dodaj kolor
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {colors.map((color) => (
          <div
            key={color.id}
            className="flex items-center gap-3 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-3"
          >
            <input
              type="color"
              value={color.hex}
              onChange={(e) => updateColor(color, { hex: e.target.value })}
              className="h-14 w-14 cursor-pointer rounded-lg border border-[#d3bb73]/20 bg-transparent"
            />
            <div className="flex-1 space-y-2">
              <input
                type="text"
                value={color.label}
                onChange={(e) => updateColor(color, { label: e.target.value })}
                placeholder="Nazwa"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-1.5 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={color.hex}
                  onChange={(e) => updateColor(color, { hex: e.target.value })}
                  className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-1.5 font-mono text-xs text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
                <select
                  value={color.role}
                  onChange={(e) => updateColor(color, { role: e.target.value })}
                  className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-1.5 text-xs text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                >
                  {COLOR_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              onClick={() => removeColor(color)}
              className="rounded-lg p-2 text-[#e5e4e2]/60 hover:bg-red-400/10 hover:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}

        {colors.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-[#d3bb73]/20 bg-[#1c1f33] p-8 text-center">
            <Palette className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/20" />
            <p className="text-sm text-[#e5e4e2]/60">Brak kolorów - dodaj kolor brandbooka</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FontsPanel({
  companyId,
  fonts,
  onChange,
  reload,
}: {
  companyId: string;
  fonts: BrandbookFont[];
  onChange: (next: BrandbookFont[]) => void;
  reload: () => Promise<void>;
}) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  const addFont = async () => {
    const { error } = await supabase.from('company_brandbook_fonts').insert({
      company_id: companyId,
      label: 'Nowy font',
      family: 'Inter, system-ui, sans-serif',
      weight: '400',
      role: 'body',
      order_index: fonts.length,
    });
    if (error) {
      showSnackbar(error.message || 'Błąd dodawania fontu', 'error');
      return;
    }
    await reload();
  };

  const updateFont = async (font: BrandbookFont, patch: Partial<BrandbookFont>) => {
    const next = fonts.map((f) => (f.id === font.id ? { ...f, ...patch } : f));
    onChange(next);
    const { error } = await supabase
      .from('company_brandbook_fonts')
      .update(patch)
      .eq('id', font.id);
    if (error) {
      showSnackbar(error.message || 'Błąd zapisu', 'error');
      await reload();
    }
  };

  const removeFont = async (font: BrandbookFont) => {
    const ok = await showConfirm({
      title: 'Usuń font',
      message: `Czy na pewno chcesz usunąć font "${font.label}"?`,
      confirmText: 'Usuń',
      cancelText: 'Anuluj',
    });
    if (!ok) return;
    const { error } = await supabase.from('company_brandbook_fonts').delete().eq('id', font.id);
    if (error) {
      showSnackbar(error.message || 'Błąd usuwania', 'error');
      return;
    }
    await reload();
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[#e5e4e2]/60">
          Rodziny fontów wykorzystywane w komunikacji marki
        </p>
        <button
          onClick={addFont}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Dodaj font
        </button>
      </div>

      <div className="space-y-3">
        {fonts.map((font) => (
          <div
            key={font.id}
            className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4"
          >
            <div className="grid gap-3 md:grid-cols-[1fr_2fr_120px_120px_auto]">
              <input
                type="text"
                value={font.label}
                onChange={(e) => updateFont(font, { label: e.target.value })}
                placeholder="Nazwa"
                className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
              <input
                type="text"
                value={font.family}
                onChange={(e) => updateFont(font, { family: e.target.value })}
                placeholder="font-family"
                className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 font-mono text-xs text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
              <input
                type="text"
                value={font.weight}
                onChange={(e) => updateFont(font, { weight: e.target.value })}
                placeholder="400"
                className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
              <select
                value={font.role}
                onChange={(e) => updateFont(font, { role: e.target.value })}
                className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              >
                {FONT_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => removeFont(font)}
                className="rounded-lg p-2 text-[#e5e4e2]/60 hover:bg-red-400/10 hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div
              className="mt-3 text-xl text-[#e5e4e2]"
              style={{ fontFamily: font.family, fontWeight: font.weight as any }}
            >
              The quick brown fox 0123456789 — Mavinci Brandbook
            </div>
          </div>
        ))}

        {fonts.length === 0 && (
          <div className="rounded-xl border border-dashed border-[#d3bb73]/20 bg-[#1c1f33] p-8 text-center">
            <Type className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/20" />
            <p className="text-sm text-[#e5e4e2]/60">Brak fontów - dodaj rodzinę pisma</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StylesPanel({
  companyId,
  styles,
  onChange,
  reload,
}: {
  companyId: string;
  styles: BrandbookStyle[];
  onChange: (next: BrandbookStyle[]) => void;
  reload: () => Promise<void>;
}) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  const addStyle = async () => {
    const { error } = await supabase.from('company_brandbook_styles').insert({
      company_id: companyId,
      key: 'new_token',
      value: '',
      description: '',
      order_index: styles.length,
    });
    if (error) {
      showSnackbar(error.message || 'Błąd dodawania', 'error');
      return;
    }
    await reload();
  };

  const updateStyle = async (style: BrandbookStyle, patch: Partial<BrandbookStyle>) => {
    const next = styles.map((s) => (s.id === style.id ? { ...s, ...patch } : s));
    onChange(next);
    const { error } = await supabase
      .from('company_brandbook_styles')
      .update(patch)
      .eq('id', style.id);
    if (error) {
      showSnackbar(error.message || 'Błąd zapisu', 'error');
      await reload();
    }
  };

  const removeStyle = async (style: BrandbookStyle) => {
    const ok = await showConfirm({
      title: 'Usuń styl',
      message: `Czy na pewno chcesz usunąć "${style.key}"?`,
      confirmText: 'Usuń',
      cancelText: 'Anuluj',
    });
    if (!ok) return;
    const { error } = await supabase.from('company_brandbook_styles').delete().eq('id', style.id);
    if (error) {
      showSnackbar(error.message || 'Błąd usuwania', 'error');
      return;
    }
    await reload();
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[#e5e4e2]/60">
          Tokeny stylu (np. radius, spacing, line-height) - klucz/wartość
        </p>
        <button
          onClick={addStyle}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Dodaj token
        </button>
      </div>

      <div className="space-y-2">
        {styles.map((style) => (
          <div
            key={style.id}
            className="grid gap-3 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-3 md:grid-cols-[200px_200px_1fr_auto]"
          >
            <input
              type="text"
              value={style.key}
              onChange={(e) => updateStyle(style, { key: e.target.value })}
              placeholder="key"
              className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 font-mono text-xs text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
            <input
              type="text"
              value={style.value}
              onChange={(e) => updateStyle(style, { value: e.target.value })}
              placeholder="value"
              className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 font-mono text-xs text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
            <input
              type="text"
              value={style.description}
              onChange={(e) => updateStyle(style, { description: e.target.value })}
              placeholder="opis (opcjonalny)"
              className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
            <button
              onClick={() => removeStyle(style)}
              className="rounded-lg p-2 text-[#e5e4e2]/60 hover:bg-red-400/10 hover:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}

        {styles.length === 0 && (
          <div className="rounded-xl border border-dashed border-[#d3bb73]/20 bg-[#1c1f33] p-8 text-center">
            <Sliders className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/20" />
            <p className="text-sm text-[#e5e4e2]/60">Brak tokenów - dodaj pierwszy token</p>
          </div>
        )}
      </div>
    </div>
  );
}
