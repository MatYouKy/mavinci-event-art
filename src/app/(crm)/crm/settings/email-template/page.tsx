'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Eye, Code, Tag, Plus, Trash2, Pencil, ChevronRight, FileText, Receipt, Ligature as FileSignature, Mail, Link as LinkIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import {
  DEFAULT_EMAIL_BODY_TEMPLATE,
  EMAIL_BODY_PLACEHOLDERS,
  renderEmailBodyTemplate,
  EmailBodyPlaceholderValues,
} from '@/lib/emailBodyTemplate';
import {
  DEFAULT_SIGNATURE_TEMPLATE,
  renderSignatureTemplate,
  SignaturePlaceholderValues,
} from '@/lib/signatureTemplate';

interface BrandbookLogo {
  id: string;
  label: string;
  url: string;
  is_default: boolean;
}

interface BrandbookColor {
  id: string;
  label: string;
  hex: string;
  role: string;
}

interface MyCompanyOption {
  id: string;
  name: string;
  legal_name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  street: string;
  building_number: string;
  apartment_number: string | null;
  city: string;
  postal_code: string;
  nip: string;
  regon: string | null;
  krs: string | null;
  logo_url: string | null;
  is_default: boolean;
  email_signature_template: string | null;
  email_signature_use_template: boolean | null;
}

interface EmailBodyTemplateRow {
  id: string;
  company_id: string;
  name: string;
  template_html: string;
  is_active: boolean;
}

type Purpose = 'general' | 'offer' | 'invoice' | 'contract' | 'link';

interface AssignmentRow {
  id: string;
  company_id: string;
  purpose: Purpose;
  template_id: string;
}

const PURPOSES: { key: Purpose; label: string; description: string; icon: any }[] = [
  {
    key: 'general',
    label: 'Wiadomość ogólna',
    description: 'Domyślny szablon dla zwykłych wiadomości email.',
    icon: Mail,
  },
  {
    key: 'offer',
    label: 'Oferty',
    description: 'Szablon używany przy wysyłce ofert (z linkiem do PDF).',
    icon: FileText,
  },
  {
    key: 'invoice',
    label: 'Faktury',
    description: 'Szablon dla wiadomości z fakturami w załączniku.',
    icon: Receipt,
  },
  {
    key: 'contract',
    label: 'Umowy',
    description: 'Szablon dla wiadomości z umowami.',
    icon: FileSignature,
  },
  {
    key: 'link',
    label: 'Wiadomość z linkiem',
    description: 'Szablon dla wiadomości zawierających link do pobrania dokumentu.',
    icon: LinkIcon,
  },
];

type Tab = 'list' | 'assignments' | 'editor';

export default function EmailTemplateSettingsPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { employee, loading: employeeLoading } = useCurrentEmployee();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showHtml, setShowHtml] = useState(false);

  const [companies, setCompanies] = useState<MyCompanyOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');

  const [templates, setTemplates] = useState<EmailBodyTemplateRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);

  const [tab, setTab] = useState<Tab>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorName, setEditorName] = useState('');
  const [editorHtml, setEditorHtml] = useState('');

  const [logos, setLogos] = useState<BrandbookLogo[]>([]);
  const [colors, setColors] = useState<BrandbookColor[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const toPublicLogoUrl = (value: string | null | undefined): string => {
    if (!value) return '';
    if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value;
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    return `${base}/storage/v1/object/public/company-logos/${value.replace(/^\/+/, '')}`;
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: comp } = await supabase
        .from('my_companies')
        .select('*')
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('name');

      const list = (comp ?? []) as MyCompanyOption[];
      setCompanies(list);
      const def = list.find((c) => c.is_default) ?? list[0];
      if (def) setSelectedCompanyId(def.id);
      setLoading(false);
    };
    load();
  }, []);

  const loadCompanyData = async (companyId: string) => {
    const [tplRes, asgRes, logosRes, colorsRes] = await Promise.all([
      supabase
        .from('email_body_templates')
        .select('id,company_id,name,template_html,is_active')
        .eq('company_id', companyId)
        .order('created_at'),
      supabase
        .from('email_body_template_assignments')
        .select('id,company_id,purpose,template_id')
        .eq('company_id', companyId),
      supabase
        .from('company_brandbook_logos')
        .select('id,label,url,is_default')
        .eq('company_id', companyId)
        .order('order_index'),
      supabase
        .from('company_brandbook_colors')
        .select('id,label,hex,role')
        .eq('company_id', companyId)
        .order('order_index'),
    ]);
    setTemplates((tplRes.data ?? []) as EmailBodyTemplateRow[]);
    setAssignments((asgRes.data ?? []) as AssignmentRow[]);
    setLogos((logosRes.data ?? []) as BrandbookLogo[]);
    setColors((colorsRes.data ?? []) as BrandbookColor[]);
  };

  useEffect(() => {
    if (!selectedCompanyId) return;
    loadCompanyData(selectedCompanyId);
    setTab('list');
    setEditingId(null);
  }, [selectedCompanyId]);

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId) || null;

  const previewSignatureHtml = useMemo(() => {
    if (!selectedCompany?.email_signature_use_template) return '';
    const sigTpl = selectedCompany?.email_signature_template || DEFAULT_SIGNATURE_TEMPLATE;
    const colorByRole = (role: string) =>
      colors.find((c) => c.role === role)?.hex || '#d3bb73';
    const rawDefaultLogo =
      logos.find((l) => l.is_default)?.url || logos[0]?.url || selectedCompany?.logo_url || '';
    const defaultLogo = toPublicLogoUrl(rawDefaultLogo);
    const addressParts = selectedCompany
      ? [
          selectedCompany.street,
          selectedCompany.building_number,
          selectedCompany.apartment_number ? `/${selectedCompany.apartment_number}` : '',
        ]
          .filter(Boolean)
          .join(' ')
      : '';
    const fullAddress = selectedCompany
      ? `${addressParts}, ${selectedCompany.postal_code} ${selectedCompany.city}`
      : '';
    const sigValues: SignaturePlaceholderValues = {
      full_name: employee
        ? `${employee.name ?? ''} ${employee.surname ?? ''}`.trim()
        : 'Jan Kowalski',
      first_name: employee?.name ?? 'Jan',
      last_name: employee?.surname ?? 'Kowalski',
      position: employee?.occupation ?? 'Stanowisko',
      phone: employee?.phone_number ?? '+48 000 000 000',
      email: employee?.email ?? 'email@example.com',
      website: selectedCompany?.website ?? '',
      signature_thumb: employee?.signature_thumb || '',
      company_name: selectedCompany?.name ?? '',
      company_legal_name: selectedCompany?.legal_name ?? '',
      company_address: fullAddress,
      company_nip: selectedCompany?.nip ?? '',
      company_regon: selectedCompany?.regon ?? '',
      company_krs: selectedCompany?.krs ?? '',
      company_logo: defaultLogo,
      company_phone: selectedCompany?.phone ?? '',
      company_email: selectedCompany?.email ?? '',
      company_website: selectedCompany?.website ?? '',
      brand_primary_color: colorByRole('primary'),
      brand_secondary_color: colorByRole('secondary'),
      brand_accent_color: colorByRole('accent'),
    };
    return renderSignatureTemplate(sigTpl, sigValues);
  }, [employee, selectedCompany, logos, colors]);

  const previewValues: EmailBodyPlaceholderValues = useMemo(() => {
    const colorByRole = (role: string) =>
      colors.find((c) => c.role === role)?.hex || '#d3bb73';

    const rawDefaultLogo =
      logos.find((l) => l.is_default)?.url || logos[0]?.url || selectedCompany?.logo_url || '';
    const defaultLogo = toPublicLogoUrl(rawDefaultLogo);

    const samplePdfLink = `
      <div style="margin: 24px 0; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #f9f9f9;">
        <p style="margin: 0 0 12px 0; font-size: 14px; color: #555;">Dokument do pobrania:</p>
        <a href="#" style="display: inline-block; padding: 12px 24px; background-color: ${colorByRole('primary')}; color: #1c1f33; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">Pobierz PDF</a>
        <p style="margin: 12px 0 0 0; font-size: 12px; color: #999;">Link jest ważny przez 7 dni.</p>
      </div>
    `;

    return {
      content:
        'Szanowni Państwo,<br><br>w załączeniu przesyłamy przygotowany dla Państwa dokument.<br><br>W razie pytań pozostaję do dyspozycji.',
      subject: 'Przykładowy temat wiadomości',
      recipient_name: 'Klient Przykładowy',
      sender_name: employee
        ? `${employee.name ?? ''} ${employee.surname ?? ''}`.trim()
        : 'Jan Kowalski',
      sender_email: employee?.email ?? 'email@example.com',
      company_logo: defaultLogo,
      company_name: selectedCompany?.name ?? '',
      company_website: selectedCompany?.website ?? '',
      brand_primary_color: colorByRole('primary'),
      brand_secondary_color: colorByRole('secondary'),
      brand_accent_color: colorByRole('accent'),
      signature: previewSignatureHtml,
      pdf_link: samplePdfLink,
    };
  }, [employee, selectedCompany, logos, colors, previewSignatureHtml]);

  const openEditor = (tpl: EmailBodyTemplateRow) => {
    setEditingId(tpl.id);
    setEditorName(tpl.name);
    setEditorHtml(tpl.template_html || DEFAULT_EMAIL_BODY_TEMPLATE);
    setTab('editor');
  };

  const handleCreateTemplate = async () => {
    if (!selectedCompanyId) return;
    const { data, error } = await supabase
      .from('email_body_templates')
      .insert({
        company_id: selectedCompanyId,
        name: 'Nowy szablon',
        template_html: DEFAULT_EMAIL_BODY_TEMPLATE,
        is_active: true,
      })
      .select()
      .maybeSingle();
    if (error || !data) {
      showSnackbar('Nie udało się utworzyć szablonu', 'error');
      return;
    }
    setTemplates((prev) => [...prev, data as EmailBodyTemplateRow]);
    openEditor(data as EmailBodyTemplateRow);
    showSnackbar('Szablon utworzony', 'success');
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('Usunąć ten szablon? Powiązania z typami wiadomości też zostaną usunięte.')) return;
    const { error } = await supabase.from('email_body_templates').delete().eq('id', id);
    if (error) {
      showSnackbar('Błąd usuwania: ' + error.message, 'error');
      return;
    }
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    setAssignments((prev) => prev.filter((a) => a.template_id !== id));
    if (editingId === id) {
      setEditingId(null);
      setTab('list');
    }
    showSnackbar('Szablon usunięty', 'success');
  };

  const handleSaveEditor = async () => {
    if (!editingId) return;
    setSaving(true);
    const { error } = await supabase
      .from('email_body_templates')
      .update({
        name: editorName.trim() || 'Bez nazwy',
        template_html: editorHtml,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editingId);
    setSaving(false);
    if (error) {
      showSnackbar('Błąd zapisu: ' + error.message, 'error');
      return;
    }
    setTemplates((prev) =>
      prev.map((t) =>
        t.id === editingId ? { ...t, name: editorName.trim() || 'Bez nazwy', template_html: editorHtml } : t,
      ),
    );
    showSnackbar('Szablon zapisany', 'success');
  };

  const handleAssign = async (purpose: Purpose, templateId: string) => {
    if (!selectedCompanyId) return;
    if (!templateId) {
      const { error } = await supabase
        .from('email_body_template_assignments')
        .delete()
        .eq('company_id', selectedCompanyId)
        .eq('purpose', purpose);
      if (error) {
        showSnackbar('Błąd: ' + error.message, 'error');
        return;
      }
      setAssignments((prev) => prev.filter((a) => !(a.purpose === purpose)));
      showSnackbar('Przypisanie usunięte', 'success');
      return;
    }
    const existing = assignments.find((a) => a.purpose === purpose);
    if (existing) {
      const { error } = await supabase
        .from('email_body_template_assignments')
        .update({ template_id: templateId, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) {
        showSnackbar('Błąd zapisu: ' + error.message, 'error');
        return;
      }
      setAssignments((prev) =>
        prev.map((a) => (a.id === existing.id ? { ...a, template_id: templateId } : a)),
      );
    } else {
      const { data, error } = await supabase
        .from('email_body_template_assignments')
        .insert({ company_id: selectedCompanyId, purpose, template_id: templateId })
        .select()
        .maybeSingle();
      if (error || !data) {
        showSnackbar('Błąd zapisu: ' + (error?.message ?? ''), 'error');
        return;
      }
      setAssignments((prev) => [...prev, data as AssignmentRow]);
    }
    showSnackbar('Przypisanie zaktualizowane', 'success');
  };

  const insertPlaceholder = (key: string) => {
    const token = `{{${key}}}`;
    const ta = textareaRef.current;
    if (!ta) {
      setEditorHtml((prev) => `${prev}${token}`);
      return;
    }
    const start = ta.selectionStart ?? editorHtml.length;
    const end = ta.selectionEnd ?? editorHtml.length;
    const next = editorHtml.slice(0, start) + token + editorHtml.slice(end);
    setEditorHtml(next);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const pos = start + token.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const handleResetToDefault = () => setEditorHtml(DEFAULT_EMAIL_BODY_TEMPLATE);

  if (employeeLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1119]">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={() => router.push('/crm/settings')}
            className="flex items-center gap-2 text-sm text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <ArrowLeft className="h-4 w-4" />
            Powrót do ustawień
          </button>
          {tab === 'editor' && editingId && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleResetToDefault}
                className="rounded-lg border border-[#d3bb73]/30 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10"
              >
                Przywróć domyślny
              </button>
              <button
                onClick={handleSaveEditor}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0f1119] transition-colors hover:bg-[#c0a85f] disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Zapisywanie...' : 'Zapisz szablon'}
              </button>
            </div>
          )}
        </div>

        <div className="mb-6">
          <h1 className="text-2xl font-light text-[#e5e4e2]">Szablony wiadomości email</h1>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Twórz wiele szablonów i przypisuj je do różnych typów wiadomości — ofert, faktur, umów
            czy zwykłej korespondencji.
          </p>
        </div>

        <div className="mb-6 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
          <label className="mb-2 block text-xs text-[#e5e4e2]/60">Firma (źródło brandbooka)</label>
          <select
            value={selectedCompanyId}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.is_default ? '(domyślna)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-6 flex gap-2 border-b border-[#d3bb73]/10">
          {(
            [
              { key: 'list' as Tab, label: 'Lista szablonów' },
              { key: 'assignments' as Tab, label: 'Domyślne dla typów' },
              ...(editingId ? [{ key: 'editor' as Tab, label: 'Edytor' }] : []),
            ]
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm transition-colors ${
                tab === t.key
                  ? 'border-b-2 border-[#d3bb73] text-[#e5e4e2]'
                  : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'list' && (
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-light text-[#e5e4e2]">Twoje szablony</h2>
              <button
                onClick={handleCreateTemplate}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#0f1119] hover:bg-[#c0a85f]"
              >
                <Plus className="h-4 w-4" />
                Nowy szablon
              </button>
            </div>

            {templates.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#d3bb73]/20 p-8 text-center text-sm text-[#e5e4e2]/60">
                Brak szablonów dla tej firmy. Utwórz pierwszy klikając „Nowy szablon&quot;.
              </div>
            ) : (
              <div className="space-y-2">
                {templates.map((tpl) => {
                  const usedIn = assignments
                    .filter((a) => a.template_id === tpl.id)
                    .map((a) => PURPOSES.find((p) => p.key === a.purpose)?.label)
                    .filter(Boolean);
                  return (
                    <div
                      key={tpl.id}
                      className="flex items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[#e5e4e2]">{tpl.name}</div>
                        {usedIn.length > 0 && (
                          <div className="mt-1 text-xs text-[#d3bb73]/80">
                            Używany w: {usedIn.join(', ')}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditor(tpl)}
                          className="flex items-center gap-1 rounded-lg border border-[#d3bb73]/20 px-3 py-1.5 text-xs text-[#e5e4e2] hover:bg-[#d3bb73]/10"
                        >
                          <Pencil className="h-3 w-3" />
                          Edytuj
                        </button>
                        <button
                          onClick={() => handleDeleteTemplate(tpl.id)}
                          className="flex items-center gap-1 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-3 w-3" />
                          Usuń
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'assignments' && (
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h2 className="mb-1 text-lg font-light text-[#e5e4e2]">Domyślne szablony dla typów</h2>
            <p className="mb-4 text-sm text-[#e5e4e2]/60">
              Wskaż, którego szablonu używać przy konkretnych rodzajach wiadomości. Jeśli żaden nie
              jest przypisany, używany jest szablon „Wiadomość ogólna&quot; lub fallback.
            </p>

            <div className="space-y-3">
              {PURPOSES.map((p) => {
                const Icon = p.icon;
                const current = assignments.find((a) => a.purpose === p.key);
                return (
                  <div
                    key={p.key}
                    className="flex items-center justify-between gap-4 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="rounded-lg bg-[#d3bb73]/10 p-2">
                        <Icon className="h-4 w-4 text-[#d3bb73]" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[#e5e4e2]">{p.label}</div>
                        <div className="text-xs text-[#e5e4e2]/60">{p.description}</div>
                      </div>
                    </div>
                    <select
                      value={current?.template_id ?? ''}
                      onChange={(e) => handleAssign(p.key, e.target.value)}
                      className="min-w-[220px] rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                    >
                      <option value="">— bez przypisania —</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'editor' && editingId && (
          <>
            <div className="mb-4 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
              <label className="mb-1 block text-xs text-[#e5e4e2]/60">Nazwa szablonu</label>
              <input
                type="text"
                value={editorName}
                onChange={(e) => setEditorName(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 lg:col-span-2">
                <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Szablon HTML</h2>
                <textarea
                  ref={textareaRef}
                  value={editorHtml}
                  onChange={(e) => setEditorHtml(e.target.value)}
                  rows={22}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 font-mono text-xs text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                />
              </div>

              <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
                <h2 className="mb-3 flex items-center gap-2 text-lg font-light text-[#e5e4e2]">
                  <Tag className="h-4 w-4" /> Placeholdery
                </h2>
                <p className="mb-3 text-xs text-[#e5e4e2]/60">
                  Kliknij aby wstawić w miejscu kursora.
                </p>
                <div className="grid max-h-[480px] grid-cols-1 gap-2 overflow-y-auto pr-1">
                  {EMAIL_BODY_PLACEHOLDERS.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => insertPlaceholder(p.key)}
                      className="flex items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-left text-xs text-[#e5e4e2] hover:border-[#d3bb73]/40"
                    >
                      <span className="text-[#e5e4e2]/80">{p.label}</span>
                      <code className="text-[#d3bb73]">{`{{${p.key}}}`}</code>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-light text-[#e5e4e2]">
                  Podgląd (z przykładową treścią i stopką)
                </h2>
                <button
                  onClick={() => setShowHtml(!showHtml)}
                  className="flex items-center gap-1 text-xs text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
                >
                  {showHtml ? <Eye className="h-3 w-3" /> : <Code className="h-3 w-3" />}
                  {showHtml ? 'Pokaż wizualnie' : 'Pokaż HTML'}
                </button>
              </div>
              {showHtml ? (
                <pre className="max-h-[600px] overflow-auto rounded-lg bg-[#0f1119] p-3 text-[10px] text-[#e5e4e2]/70">
                  {renderEmailBodyTemplate(editorHtml, previewValues)}
                </pre>
              ) : (
                <div
                  className="overflow-auto rounded-lg bg-white p-6"
                  dangerouslySetInnerHTML={{
                    __html: renderEmailBodyTemplate(editorHtml, previewValues),
                  }}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
