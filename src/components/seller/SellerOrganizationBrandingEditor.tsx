'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import SearchCombobox from '@/components/crm/SearchCombobox';
import { supabase } from '@/lib/supabase/browser';
import type { SellerBranding, SellerPortalContext } from '@/lib/seller/portal';
import { identityAssetPatch, OfferVisualIdentityFields, uploadIdentityAssets, type IdentityAssetKind } from './OfferIdentityFields';
import { sellerUploadedFonts } from './OfferHeadingFontPicker';

type BrandingVersion = { branding: SellerBranding; revision: number; updated_at: string | null; updated_by: string | null };
type Props = {
  companyId: string;
  companyName: string;
  partnerId: string;
  organizations: SellerPortalContext['organizations'];
  initialOrganizationId?: string | null;
  disabled?: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
};

function errorMessage(cause: unknown) {
  const error = cause as { code?: string; message?: string };
  return ['PGRST202', '42883', '42703'].includes(error.code || '')
    ? 'Nie można teraz zapisać wspólnego brandingu. Spróbuj później lub napisz do opiekuna. Twoje pliki nie zostały zmienione.'
    : error.message || 'Nie udało się zapisać lub odczytać brandingu. Spróbuj ponownie.';
}

export default function SellerOrganizationBrandingEditor({ companyId, companyName, partnerId, organizations,
  initialOrganizationId, disabled, onDirtyChange, onBusyChange }: Props) {
  const [organizationId, setOrganizationId] = useState(initialOrganizationId || organizations[0]?.id || '');
  const [loaded, setLoaded] = useState<(BrandingVersion & { scope: string }) | null>(null);
  const [form, setForm] = useState<SellerBranding>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<IdentityAssetKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const operation = useRef(false);
  const generation = useRef(0);
  const scope = `${partnerId}:${companyId}:${organizationId}`;
  const organization = organizations.find((item) => item.id === organizationId);
  const ready = !loading && loaded?.scope === scope && Boolean(organization);
  const dirty = ready && JSON.stringify(form) !== JSON.stringify(loaded?.branding);
  const busy = saving || Boolean(uploading);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { onDirtyChange(false); onBusyChange(false); }, [onDirtyChange, onBusyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    const request = ++generation.current;
    setLoading(true); setLoaded(null); setError(''); setMessage(''); setConflict(false);
    if (!companyId || !organizationId) { setLoading(false); return; }
    void (async () => {
      try {
        const { data, error: failed } = await supabase.rpc('get_seller_organization_branding', {
          p_organization: organizationId, p_company: companyId,
        });
        if (failed) throw failed;
        if (generation.current !== request) return;
        const version = data as BrandingVersion;
        setLoaded({ ...version, scope }); setForm(version.branding);
      } catch (cause) { if (generation.current === request) setError(errorMessage(cause)); }
      finally { if (generation.current === request) setLoading(false); }
    })();
    return () => { generation.current += 1; };
  }, [scope, companyId, organizationId, attempt]);

  const upload = async (files: File[], kind: IdentityAssetKind) => {
    if (!ready || disabled || operation.current || !files.length || kind === 'portrait') return;
    operation.current = true; setUploading(kind); setError(''); setMessage('');
    const request = generation.current;
    try {
      const paths = await uploadIdentityAssets({ files, kind, companyId, partnerId, organizationId,
        galleryCount: form.venue_image_urls?.length || 0, fontCount: sellerUploadedFonts(form).length });
      if (request !== generation.current) return;
      setForm((current) => ({ ...current, ...identityAssetPatch(kind, paths, current, files) }));
      setMessage('Plik wgrany. Zapisz branding organizacji, aby pozostali sprzedawcy mogli go używać.');
    } catch (cause) { if (request === generation.current) setError(errorMessage(cause)); }
    finally { operation.current = false; setUploading(null); }
  };

  const save = async () => {
    if (!ready || !loaded || !dirty || disabled || conflict || operation.current) return;
    operation.current = true; setSaving(true); setError(''); setMessage('');
    const request = generation.current;
    try {
      const { data, error: failed } = await supabase.rpc('save_seller_organization_branding', {
        p_organization: organizationId, p_company: companyId, p_branding: form, p_expected_revision: loaded.revision,
      });
      if (failed) throw failed;
      if (request !== generation.current) return;
      const version = data as BrandingVersion;
      setLoaded({ ...version, scope }); setForm(version.branding);
      setMessage('Zapisano wspólny branding. Nowe oferty tej organizacji użyją tych ustawień. Nie zmieniono istniejących ofert ani zapisanych PDF-ów.');
    } catch (cause) {
      if (request !== generation.current) return;
      setError(errorMessage(cause));
      if ((cause as { code?: string }).code === '40001') setConflict(true);
    } finally { operation.current = false; setSaving(false); }
  };

  const canDiscard = () => !dirty || window.confirm('Masz niezapisane zmiany brandingu organizacji. Porzucić je i wczytać wybrane ustawienia?');
  return <section id="organization-branding" className="scroll-mt-4 space-y-4 rounded-xl bg-white/[0.025] p-4 md:p-5">
    <header className="space-y-2">
      <h2 className="text-sm font-medium">Wspólny branding organizacji · {companyName}</h2>
      <p className="text-sm leading-6 text-white/65">Każdy sprzedawca przypisany do organizacji może zmieniać jej logo, zdjęcia, kolory i wygląd ofert. Zapis dotyczy wszystkich jej sprzedawców dla marki {companyName}, nie tylko Twojego konta.</p>
      <p className="text-xs leading-5 text-white/45">Wizytówka i zdjęcie sprzedawcy są osobiste. Zmiana brandingu nie nadpisuje istniejących ofert ani zapisanych PDF-ów. Sale, plany i dane techniczne uzupełnia CRM.</p>
    </header>
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-xs text-white/50">Organizacja, której wygląd edytujesz</p>
        <SearchCombobox value={organizationId} options={organizations.map((item) => ({ id: item.id, label: item.name }))}
          disabled={disabled || busy} allowClear={false} ariaLabel="Organizacja edytowanego brandingu" placeholder="Wybierz organizację…"
          onChange={(id) => { if (id !== organizationId && canDiscard()) setOrganizationId(id); }} />
      </div>
      <button type="button" disabled={disabled || busy || loading} onClick={() => { if (canDiscard()) setAttempt((value) => value + 1); }}
        className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-4 py-2.5 text-sm text-[#d3bb73] disabled:opacity-40"><RefreshCw className="h-4 w-4" />Wczytaj aktualny branding</button>
    </div>
    <p className="text-xs text-white/45">Ten wybór nie zmienia domyślnej organizacji dla nowych ofert.</p>
    {loading && <p role="status" className="flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" />Wczytywanie brandingu…</p>}
    {error && <p role="alert" className="rounded-lg bg-amber-300/10 p-4 text-sm leading-6 text-amber-200">{error}{conflict && ' Twoje zmiany zostały w formularzu. Porównaj je, a następnie użyj „Wczytaj aktualny branding”.'}</p>}
    {message && <p role="status" className="rounded-lg bg-emerald-300/10 p-4 text-sm leading-6 text-emerald-200">{message}</p>}
    {ready && <>
      <p className="text-xs text-white/45">{loaded?.updated_at
        ? `Ostatni zapis: ${new Date(loaded.updated_at).toLocaleString('pl-PL')}${loaded.updated_by ? ` · ${loaded.updated_by}` : ''}`
        : 'Ta organizacja nie ma jeszcze zapisanego brandingu tej marki.'}</p>
      <OfferVisualIdentityFields companyId={companyId} value={form} onChange={(patch) => { setForm((value) => ({ ...value, ...patch })); setMessage(''); }}
        onUpload={upload} uploading={uploading} disabled={disabled || busy} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        {dirty && <span className="text-xs text-amber-200">Niezapisane zmiany wspólnego brandingu</span>}
        <button type="button" disabled={disabled || busy || !dirty || conflict} onClick={() => void save()}
          className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-3 text-sm font-medium text-[#111522] disabled:opacity-40">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Zapisz branding · {organization?.name}
        </button>
      </div>
    </>}
  </section>;
}
