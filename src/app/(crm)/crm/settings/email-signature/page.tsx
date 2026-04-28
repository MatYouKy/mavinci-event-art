'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Eye, Code } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import {
  EmailSignaturePreview,
  generateEmailSignature,
} from '@/components/crm/EmailSignatureGenerator';

interface SignatureRow {
  employee_id: string;
  full_name: string;
  position: string | null;
  phone: string | null;
  email: string;
  website: string | null;
  avatar_url: string | null;
  custom_html: string | null;
  use_custom_html: boolean | null;
}

export default function EmailSignatureSettingsPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { employee, loading: employeeLoading } = useCurrentEmployee();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showHtml, setShowHtml] = useState(false);

  const [form, setForm] = useState<SignatureRow>({
    employee_id: '',
    full_name: '',
    position: '',
    phone: '',
    email: '',
    website: '',
    avatar_url: '',
    custom_html: '',
    use_custom_html: false,
  });

  useEffect(() => {
    if (!employee?.id) return;

    const load = async () => {
      setLoading(true);
      const { data: existing } = await supabase
        .from('employee_signatures')
        .select('*')
        .eq('employee_id', employee.id)
        .maybeSingle();

      const { data: empData } = await supabase
        .from('employees')
        .select('name, surname, email, phone_number, occupation, signature_thumb, avatar_url')
        .eq('id', employee.id)
        .maybeSingle();

      if (existing) {
        setForm({
          employee_id: existing.employee_id,
          full_name: existing.full_name ?? '',
          position: existing.position ?? '',
          phone: existing.phone ?? '',
          email: existing.email ?? '',
          website: existing.website ?? '',
          avatar_url: existing.avatar_url ?? '',
          custom_html: existing.custom_html ?? '',
          use_custom_html: !!existing.use_custom_html,
        });
      } else {
        const fullName = `${empData?.name ?? ''} ${empData?.surname ?? ''}`.trim();
        setForm({
          employee_id: employee.id,
          full_name: fullName,
          position: empData?.occupation ?? '',
          phone: empData?.phone_number ?? '',
          email: empData?.email ?? '',
          website: 'https://mavinci.pl',
          avatar_url: empData?.signature_thumb ?? empData?.avatar_url ?? '',
          custom_html: '',
          use_custom_html: false,
        });
      }
      setLoading(false);
    };

    load();
  }, [employee?.id]);

  const handleSave = async () => {
    if (!employee?.id) return;

    if (!form.full_name.trim() || !form.email.trim()) {
      showSnackbar('Imię i email są wymagane', 'error');
      return;
    }

    setSaving(true);

    const payload = {
      employee_id: employee.id,
      full_name: form.full_name.trim(),
      position: form.position?.trim() || null,
      phone: form.phone?.trim() || null,
      email: form.email.trim(),
      website: form.website?.trim() || null,
      avatar_url: form.avatar_url?.trim() || null,
      custom_html: form.custom_html || null,
      use_custom_html: !!form.use_custom_html,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('employee_signatures')
      .upsert(payload, { onConflict: 'employee_id' });

    setSaving(false);

    if (error) {
      console.error(error);
      showSnackbar('Błąd zapisu stopki: ' + error.message, 'error');
      return;
    }

    showSnackbar('Stopka została zapisana', 'success');
  };

  const handleGenerateFromFields = () => {
    const html = generateEmailSignature({
      full_name: form.full_name,
      position: form.position || undefined,
      phone: form.phone || undefined,
      email: form.email,
      website: form.website || undefined,
      avatar_url: form.avatar_url || undefined,
    });
    setForm((prev) => ({ ...prev, custom_html: html, use_custom_html: true }));
    showSnackbar('HTML stopki został wygenerowany z danych formularza', 'success');
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
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={() => router.push('/crm/settings')}
            className="flex items-center gap-2 text-sm text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <ArrowLeft className="h-4 w-4" />
            Powrót do ustawień
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0f1119] transition-colors hover:bg-[#c0a85f] disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Zapisywanie...' : 'Zapisz stopkę'}
          </button>
        </div>

        <div className="mb-6">
          <h1 className="text-2xl font-light text-[#e5e4e2]">Stopka Email</h1>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Konfiguruj swoją stopkę używaną przy wysyłaniu wiadomości email
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Dane stopki</h2>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-[#e5e4e2]/60">Imię i nazwisko *</label>
                <input
                  type="text"
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-[#e5e4e2]/60">Stanowisko</label>
                <input
                  type="text"
                  value={form.position ?? ''}
                  onChange={(e) => setForm({ ...form, position: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">Email *</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">Telefon</label>
                  <input
                    type="text"
                    value={form.phone ?? ''}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-[#e5e4e2]/60">Strona WWW</label>
                <input
                  type="text"
                  value={form.website ?? ''}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-[#e5e4e2]/60">URL miniaturki / avatara</label>
                <input
                  type="text"
                  value={form.avatar_url ?? ''}
                  onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                />
                <p className="mt-1 text-[10px] text-[#e5e4e2]/40">
                  Jeśli pracownik ma ustawioną dedykowaną miniaturkę do stopki, zostanie użyta automatycznie przy wysyłce.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3">
                <div>
                  <div className="text-sm font-medium text-[#e5e4e2]">Użyj własnego HTML</div>
                  <div className="text-xs text-[#e5e4e2]/60">
                    Zamiast generowanego szablonu - skorzystaj z własnego kodu HTML
                  </div>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={!!form.use_custom_html}
                    onChange={(e) => setForm({ ...form, use_custom_html: e.target.checked })}
                    className="peer sr-only"
                  />
                  <div className="peer h-6 w-11 rounded-full bg-[#0f1119] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-[#d3bb73]/40 after:bg-[#1c1f33] after:transition-all after:content-[''] peer-checked:bg-[#d3bb73]/30 peer-checked:after:translate-x-full peer-checked:after:border-[#d3bb73] peer-checked:after:bg-[#d3bb73]"></div>
                </label>
              </div>

              {form.use_custom_html && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-xs text-[#e5e4e2]/60">Własny HTML</label>
                    <button
                      type="button"
                      onClick={handleGenerateFromFields}
                      className="text-xs text-[#d3bb73] hover:underline"
                    >
                      Wygeneruj z pól powyżej
                    </button>
                  </div>
                  <textarea
                    value={form.custom_html ?? ''}
                    onChange={(e) => setForm({ ...form, custom_html: e.target.value })}
                    rows={12}
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 font-mono text-xs text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-light text-[#e5e4e2]">Podgląd</h2>
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
                {form.use_custom_html && form.custom_html
                  ? form.custom_html
                  : generateEmailSignature({
                      full_name: form.full_name,
                      position: form.position || undefined,
                      phone: form.phone || undefined,
                      email: form.email,
                      website: form.website || undefined,
                      avatar_url: form.avatar_url || undefined,
                    })}
              </pre>
            ) : form.use_custom_html && form.custom_html ? (
              <div
                className="overflow-auto rounded-lg bg-white p-6"
                dangerouslySetInnerHTML={{ __html: form.custom_html }}
              />
            ) : (
              <EmailSignaturePreview
                data={{
                  full_name: form.full_name,
                  position: form.position || undefined,
                  phone: form.phone || undefined,
                  email: form.email,
                  website: form.website || undefined,
                  avatar_url: form.avatar_url || undefined,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
