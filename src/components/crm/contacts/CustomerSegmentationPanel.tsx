'use client';

import { useEffect, useMemo, useState } from 'react';
import { MailCheck, Plus, RefreshCw, Save, ShieldCheck, Tags } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

type EntityType = 'contact' | 'organization';
type Segment = { id: string; name: string; slug: string; color: string; is_system: boolean };
type MarketingProfile = {
  id?: string;
  marketing_status: 'unknown' | 'subscribed' | 'unsubscribed' | 'objected';
  legal_basis: 'none' | 'consent' | 'legitimate_interest' | 'existing_customer';
  email_deliverability: 'unknown' | 'valid' | 'bounced' | 'invalid';
  interests: string[];
  event_types: string[];
  regions: string[];
  budget_min: number | null;
  budget_max: number | null;
  communication_frequency: 'important_only' | 'occasional' | 'monthly' | 'weekly';
  consent_source: string | null;
  consent_evidence: string | null;
  consent_granted_at: string | null;
  consent_withdrawn_at: string | null;
};

const EMPTY_PROFILE: MarketingProfile = {
  marketing_status: 'unknown',
  legal_basis: 'none',
  email_deliverability: 'unknown',
  interests: [],
  event_types: [],
  regions: [],
  budget_min: null,
  budget_max: null,
  communication_frequency: 'occasional',
  consent_source: null,
  consent_evidence: null,
  consent_granted_at: null,
  consent_withdrawn_at: null,
};

const splitValues = (value: string) => Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean)));
const toLocalDateTime = (value: string | null) => value
  ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  : '';
const makeSlug = (value: string) => value.toLocaleLowerCase('pl-PL').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export default function CustomerSegmentationPanel({
  entityType,
  entityId,
  email,
}: {
  entityType: EntityType;
  entityId: string;
  email?: string | null;
}) {
  const { showSnackbar } = useSnackbar();
  const [profile, setProfile] = useState<MarketingProfile>(EMPTY_PROFILE);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedSegments, setSelectedSegments] = useState<string[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newSegmentName, setNewSegmentName] = useState('');

  const entityColumn = entityType === 'contact' ? 'contact_id' : 'organization_id';

  const load = async () => {
    setLoading(true);
    const { data: authData } = await supabase.auth.getUser();
    const [profileResult, segmentsResult, membersResult, employeeResult] = await Promise.all([
      supabase.from('customer_marketing_profiles').select('*').eq(entityColumn, entityId).maybeSingle(),
      supabase.from('marketing_segments').select('id, name, slug, color, is_system').eq('is_active', true).order('name'),
      supabase.from('customer_marketing_segment_members').select('segment_id').eq(entityColumn, entityId),
      authData.user
        ? supabase.from('employees').select('role, access_level, permissions').eq('id', authData.user.id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const loadError = [profileResult, segmentsResult, membersResult].find((result) => result.error)?.error;
    if (loadError) {
      console.error('Error loading customer segmentation:', loadError);
      showSnackbar(loadError.message || 'Nie udało się pobrać segmentacji klienta', 'error');
      setLoading(false);
      return;
    }

    setProfile(profileResult.data ? { ...EMPTY_PROFILE, ...profileResult.data } : EMPTY_PROFILE);
    setSegments((segmentsResult.data || []) as Segment[]);
    setSelectedSegments((membersResult.data || []).map((member) => member.segment_id));
    const employee = employeeResult.data as any;
    setCanEdit(Boolean(employee && (
      employee.role === 'admin'
      || employee.access_level === 'admin'
      || employee.permissions?.includes('contacts_manage')
    )));
    setLoading(false);
  };

  useEffect(() => { void load(); }, [entityId, entityType]);

  const eligible = useMemo(() => Boolean(
    email
    && profile.marketing_status === 'subscribed'
    && profile.legal_basis !== 'none'
    && !['bounced', 'invalid'].includes(profile.email_deliverability)
  ), [email, profile.email_deliverability, profile.legal_basis, profile.marketing_status]);

  const save = async () => {
    if (!canEdit) return;
    if (profile.marketing_status === 'subscribed' && profile.legal_basis === 'none') {
      showSnackbar('Wskaż podstawę prawną komunikacji marketingowej', 'error');
      return;
    }
    if (profile.marketing_status === 'subscribed' && profile.legal_basis === 'consent' && !profile.consent_granted_at) {
      showSnackbar('Dla zgody podaj datę jej udzielenia', 'error');
      return;
    }

    setSaving(true);
    const profilePayload = {
      [entityColumn]: entityId,
      marketing_status: profile.marketing_status,
      legal_basis: profile.legal_basis,
      email_deliverability: profile.email_deliverability,
      interests: profile.interests,
      event_types: profile.event_types,
      regions: profile.regions,
      budget_min: profile.budget_min,
      budget_max: profile.budget_max,
      communication_frequency: profile.communication_frequency,
      consent_source: profile.consent_source || null,
      consent_evidence: profile.consent_evidence || null,
      consent_granted_at: profile.consent_granted_at,
      consent_withdrawn_at: ['unsubscribed', 'objected'].includes(profile.marketing_status)
        ? profile.consent_withdrawn_at || new Date().toISOString()
        : null,
    };

    const profileResult = profile.id
      ? await supabase.from('customer_marketing_profiles').update(profilePayload).eq('id', profile.id).select().single()
      : await supabase.from('customer_marketing_profiles').insert(profilePayload).select().single();

    if (profileResult.error) {
      setSaving(false);
      showSnackbar(profileResult.error.message || 'Nie udało się zapisać profilu marketingowego', 'error');
      return;
    }

    const { data: existingMembers, error: existingError } = await supabase
      .from('customer_marketing_segment_members').select('id, segment_id').eq(entityColumn, entityId);
    if (existingError) {
      setSaving(false);
      showSnackbar(existingError.message || 'Nie udało się zapisać segmentów', 'error');
      return;
    }
    const existingIds = new Set((existingMembers || []).map((member) => member.segment_id));
    const selectedIds = new Set(selectedSegments);
    const deleteIds = (existingMembers || []).filter((member) => !selectedIds.has(member.segment_id)).map((member) => member.id);
    const insertIds = selectedSegments.filter((id) => !existingIds.has(id));

    const operations: Array<PromiseLike<any>> = [];
    if (deleteIds.length) operations.push(supabase.from('customer_marketing_segment_members').delete().in('id', deleteIds));
    if (insertIds.length) operations.push(supabase.from('customer_marketing_segment_members').insert(insertIds.map((segmentId) => ({ segment_id: segmentId, [entityColumn]: entityId, assignment_source: 'manual' }))));
    const results = await Promise.all(operations);
    const segmentError = results.find((result) => result.error)?.error;
    setSaving(false);
    if (segmentError) return showSnackbar(segmentError.message || 'Nie udało się zapisać segmentów', 'error');

    setProfile({ ...EMPTY_PROFILE, ...profileResult.data });
    showSnackbar('Segmentacja i preferencje zostały zapisane', 'success');
  };

  const addSegment = async () => {
    const name = newSegmentName.trim();
    const slug = makeSlug(name);
    if (!name || !slug || !canEdit) return;
    const { data, error } = await supabase.from('marketing_segments').insert({ name, slug }).select('id, name, slug, color, is_system').single();
    if (error) return showSnackbar(error.message || 'Nie udało się utworzyć segmentu', 'error');
    setSegments((current) => [...current, data as Segment].sort((a, b) => a.name.localeCompare(b.name, 'pl')));
    setSelectedSegments((current) => [...current, data.id]);
    setNewSegmentName('');
  };

  if (loading) return <div className="flex min-h-32 items-center justify-center rounded-xl border border-gray-800 bg-[#1a1d2e]"><RefreshCw className="h-5 w-5 animate-spin text-[#d3bb73]" /></div>;

  return (
    <section className="rounded-xl border border-gray-800 bg-[#1a1d2e] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2"><Tags className="mt-0.5 h-5 w-5 text-[#d3bb73]" /><div><h3 className="font-semibold text-white">Segmentacja i komunikacja</h3><p className="mt-1 text-xs text-gray-500">Zainteresowania są niezależne od zgody na mailing.</p></div></div>
        <span className={`rounded-full px-2.5 py-1 text-xs ${eligible ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-700/50 text-gray-400'}`}>{eligible ? 'Mailing dozwolony' : 'Mailing niedozwolony'}</span>
      </div>

      <div className="mt-4 space-y-4">
        <div><span className="mb-2 block text-xs text-gray-400">Segmenty</span><div className="flex flex-wrap gap-2">{segments.map((segment) => { const selected = selectedSegments.includes(segment.id); return <button type="button" disabled={!canEdit} key={segment.id} onClick={() => setSelectedSegments((current) => selected ? current.filter((id) => id !== segment.id) : [...current, segment.id])} className={`rounded-full border px-3 py-1.5 text-xs disabled:cursor-not-allowed ${selected ? 'border-[#d3bb73]/50 bg-[#d3bb73]/15 text-[#e1cc8d]' : 'border-gray-700 text-gray-400'}`}><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: segment.color }} />{segment.name}</button>; })}</div></div>

        {canEdit && <div className="flex gap-2"><input value={newSegmentName} onChange={(event) => setNewSegmentName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), void addSegment())} placeholder="Nowy segment…" className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-[#0f1119] px-3 py-2 text-sm text-white" /><button type="button" onClick={() => void addSegment()} className="rounded-lg border border-[#d3bb73]/30 p-2 text-[#d3bb73]"><Plus className="h-4 w-4" /></button></div>}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-gray-400">Status komunikacji<select disabled={!canEdit} value={profile.marketing_status} onChange={(event) => setProfile({ ...profile, marketing_status: event.target.value as MarketingProfile['marketing_status'] })} className="mt-1.5 w-full rounded-lg border border-gray-700 bg-[#0f1119] px-3 py-2.5 text-sm text-white disabled:opacity-60"><option value="unknown">Nieustalony</option><option value="subscribed">Dopuszczona</option><option value="unsubscribed">Wypisany</option><option value="objected">Sprzeciw — nie kontaktować</option></select></label>
          <label className="text-xs text-gray-400">Podstawa prawna<select disabled={!canEdit} value={profile.legal_basis} onChange={(event) => setProfile({ ...profile, legal_basis: event.target.value as MarketingProfile['legal_basis'] })} className="mt-1.5 w-full rounded-lg border border-gray-700 bg-[#0f1119] px-3 py-2.5 text-sm text-white disabled:opacity-60"><option value="none">Brak</option><option value="consent">Zgoda</option><option value="legitimate_interest">Uzasadniony interes</option><option value="existing_customer">Istniejący klient</option></select></label>
          <label className="text-xs text-gray-400">Dostarczalność e-maila<select disabled={!canEdit} value={profile.email_deliverability} onChange={(event) => setProfile({ ...profile, email_deliverability: event.target.value as MarketingProfile['email_deliverability'] })} className="mt-1.5 w-full rounded-lg border border-gray-700 bg-[#0f1119] px-3 py-2.5 text-sm text-white disabled:opacity-60"><option value="unknown">Niezweryfikowany</option><option value="valid">Poprawny</option><option value="bounced">Odbija wiadomości</option><option value="invalid">Nieprawidłowy</option></select></label>
          <label className="text-xs text-gray-400">Częstotliwość<select disabled={!canEdit} value={profile.communication_frequency} onChange={(event) => setProfile({ ...profile, communication_frequency: event.target.value as MarketingProfile['communication_frequency'] })} className="mt-1.5 w-full rounded-lg border border-gray-700 bg-[#0f1119] px-3 py-2.5 text-sm text-white disabled:opacity-60"><option value="important_only">Tylko ważne informacje</option><option value="occasional">Okazjonalnie</option><option value="monthly">Miesięcznie</option><option value="weekly">Tygodniowo</option></select></label>
        </div>

        <label className="block text-xs text-gray-400">Zainteresowania, oddzielone przecinkami<input disabled={!canEdit} value={profile.interests.join(', ')} onChange={(event) => setProfile({ ...profile, interests: splitValues(event.target.value) })} placeholder="DJ, ciężki dym, fotobudka" className="mt-1.5 w-full rounded-lg border border-gray-700 bg-[#0f1119] px-3 py-2.5 text-sm text-white disabled:opacity-60" /></label>
        <label className="block text-xs text-gray-400">Typy wydarzeń<input disabled={!canEdit} value={profile.event_types.join(', ')} onChange={(event) => setProfile({ ...profile, event_types: splitValues(event.target.value) })} placeholder="wesele, event firmowy" className="mt-1.5 w-full rounded-lg border border-gray-700 bg-[#0f1119] px-3 py-2.5 text-sm text-white disabled:opacity-60" /></label>
        <label className="block text-xs text-gray-400">Regiony<input disabled={!canEdit} value={profile.regions.join(', ')} onChange={(event) => setProfile({ ...profile, regions: splitValues(event.target.value) })} placeholder="Olsztyn, warmińsko-mazurskie" className="mt-1.5 w-full rounded-lg border border-gray-700 bg-[#0f1119] px-3 py-2.5 text-sm text-white disabled:opacity-60" /></label>

        <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-gray-400">Budżet od<input disabled={!canEdit} type="number" min="0" value={profile.budget_min ?? ''} onChange={(event) => setProfile({ ...profile, budget_min: event.target.value ? Number(event.target.value) : null })} className="mt-1.5 w-full rounded-lg border border-gray-700 bg-[#0f1119] px-3 py-2.5 text-sm text-white disabled:opacity-60" /></label><label className="text-xs text-gray-400">Budżet do<input disabled={!canEdit} type="number" min="0" value={profile.budget_max ?? ''} onChange={(event) => setProfile({ ...profile, budget_max: event.target.value ? Number(event.target.value) : null })} className="mt-1.5 w-full rounded-lg border border-gray-700 bg-[#0f1119] px-3 py-2.5 text-sm text-white disabled:opacity-60" /></label></div>

        {profile.legal_basis === 'consent' && <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-gray-400">Data zgody<input disabled={!canEdit} type="datetime-local" value={toLocalDateTime(profile.consent_granted_at)} onChange={(event) => setProfile({ ...profile, consent_granted_at: event.target.value ? new Date(event.target.value).toISOString() : null })} className="mt-1.5 w-full rounded-lg border border-gray-700 bg-[#0f1119] px-3 py-2.5 text-sm text-white disabled:opacity-60" /></label><label className="text-xs text-gray-400">Źródło zgody<input disabled={!canEdit} value={profile.consent_source || ''} onChange={(event) => setProfile({ ...profile, consent_source: event.target.value })} placeholder="formularz, umowa, e-mail" className="mt-1.5 w-full rounded-lg border border-gray-700 bg-[#0f1119] px-3 py-2.5 text-sm text-white disabled:opacity-60" /></label><label className="block text-xs text-gray-400 sm:col-span-2">Dowód / notatka<input disabled={!canEdit} value={profile.consent_evidence || ''} onChange={(event) => setProfile({ ...profile, consent_evidence: event.target.value })} placeholder="Treść zgody, identyfikator formularza lub dokumentu" className="mt-1.5 w-full rounded-lg border border-gray-700 bg-[#0f1119] px-3 py-2.5 text-sm text-white disabled:opacity-60" /></label></div>}

        <div className="rounded-lg border border-sky-400/15 bg-sky-400/5 p-3 text-xs leading-5 text-sky-100/70"><ShieldCheck className="mr-2 inline h-4 w-4" />Automatyczne zapytania mogą dodać zainteresowania i segment, ale status pozostaje „Nieustalony”, dopóki uprawniona osoba nie zapisze podstawy komunikacji.</div>
        {!email && <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200"><MailCheck className="mr-2 inline h-4 w-4" />Brak adresu e-mail — klient nie trafi na listę odbiorców.</div>}

        {canEdit && <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#1c1f33] disabled:opacity-50">{saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? 'Zapisywanie…' : 'Zapisz segmentację'}</button>}
      </div>
    </section>
  );
}
