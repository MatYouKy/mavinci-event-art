'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Eye, Code, Tag } from 'lucide-react';
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
  email_body_template: string | null;
  email_body_use_template: boolean | null;
  email_signature_template: string | null;
  email_signature_use_template: boolean | null;
}

export default function EmailTemplateSettingsPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { employee, loading: employeeLoading } = useCurrentEmployee();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showHtml, setShowHtml] = useState(false);

  const [companies, setCompanies] = useState<MyCompanyOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [template, setTemplate] = useState<string>(DEFAULT_EMAIL_BODY_TEMPLATE);
  const [useTemplate, setUseTemplate] = useState<boolean>(true);

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
      if (def) {
        setSelectedCompanyId(def.id);
        setTemplate(def.email_body_template || DEFAULT_EMAIL_BODY_TEMPLATE);
        setUseTemplate(!!def.email_body_use_template);
      }
      setLoading(false);
    };
    load();
  }, []);

  useEffect(() => {
    if (!selectedCompanyId) return;
    const fetchBrand = async () => {
      const [logosRes, colorsRes] = await Promise.all([
        supabase
          .from('company_brandbook_logos')
          .select('id,label,url,is_default')
          .eq('company_id', selectedCompanyId)
          .order('order_index'),
        supabase
          .from('company_brandbook_colors')
          .select('id,label,hex,role')
          .eq('company_id', selectedCompanyId)
          .order('order_index'),
      ]);
      setLogos((logosRes.data ?? []) as BrandbookLogo[]);
      setColors((colorsRes.data ?? []) as BrandbookColor[]);
    };
    fetchBrand();
  }, [selectedCompanyId]);

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId) || null;

  useEffect(() => {
    if (!selectedCompany) return;
    setTemplate(selectedCompany.email_body_template || DEFAULT_EMAIL_BODY_TEMPLATE);
    setUseTemplate(!!selectedCompany.email_body_use_template);
  }, [selectedCompany]);

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
      full_name: employee ? `${employee.name ?? ''} ${employee.surname ?? ''}`.trim() : 'Jan Kowalski',
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

  const handleSave = async () => {
    if (!selectedCompanyId) {
      showSnackbar('Wybierz firmę aby zapisać szablon wiadomości', 'error');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('my_companies')
      .update({
        email_body_template: template,
        email_body_use_template: useTemplate,
        updated_at: new Date().toISOString(),
      })
      .eq('id', selectedCompanyId);
    setSaving(false);

    if (error) {
      console.error(error);
      showSnackbar('Błąd zapisu: ' + error.message, 'error');
      return;
    }
    showSnackbar('Szablon wiadomości zapisany dla firmy', 'success');
  };

  const insertPlaceholder = (key: string) => {
    const token = `{{${key}}}`;
    const ta = textareaRef.current;
    if (!ta) {
      setTemplate((prev) => `${prev}${token}`);
      return;
    }
    const start = ta.selectionStart ?? template.length;
    const end = ta.selectionEnd ?? template.length;
    const next = template.slice(0, start) + token + template.slice(end);
    setTemplate(next);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const pos = start + token.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const handleResetToDefault = () => {
    setTemplate(DEFAULT_EMAIL_BODY_TEMPLATE);
  };

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
          <div className="flex items-center gap-2">
            <button
              onClick={handleResetToDefault}
              className="rounded-lg border border-[#d3bb73]/30 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10"
            >
              Przywróć domyślny
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0f1119] transition-colors hover:bg-[#c0a85f] disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Zapisywanie...' : 'Zapisz szablon'}
            </button>
          </div>
        </div>

        <div className="mb-6">
          <h1 className="text-2xl font-light text-[#e5e4e2]">Szablon wiadomości email</h1>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Edytuj globalny szablon HTML treści wiadomości. Logotyp, kolory marki, treść, link do PDF
            i stopka będą podstawiane automatycznie.
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

          <div className="mt-3 flex items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3">
            <div>
              <div className="text-sm font-medium text-[#e5e4e2]">Używaj tego szablonu</div>
              <div className="text-xs text-[#e5e4e2]/60">
                Gdy wyłączone - wiadomości będą wysyłane bez szablonu (sama treść + stopka).
              </div>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={useTemplate}
                onChange={(e) => setUseTemplate(e.target.checked)}
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-[#0f1119] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-[#d3bb73]/40 after:bg-[#1c1f33] after:transition-all after:content-[''] peer-checked:bg-[#d3bb73]/30 peer-checked:after:translate-x-full peer-checked:after:border-[#d3bb73] peer-checked:after:bg-[#d3bb73]"></div>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Szablon HTML</h2>
            <textarea
              ref={textareaRef}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={22}
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 font-mono text-xs text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
            />
          </div>

          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-light text-[#e5e4e2]">
              <Tag className="h-4 w-4" /> Placeholdery
            </h2>
            <p className="mb-3 text-xs text-[#e5e4e2]/60">
              Kliknij aby wstawić w miejscu kursora w szablonie.
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
            <h2 className="text-lg font-light text-[#e5e4e2]">Podgląd (z przykładową treścią i stopką)</h2>
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
              {renderEmailBodyTemplate(template, previewValues)}
            </pre>
          ) : (
            <div
              className="overflow-auto rounded-lg bg-white p-6"
              dangerouslySetInnerHTML={{
                __html: renderEmailBodyTemplate(template, previewValues),
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
