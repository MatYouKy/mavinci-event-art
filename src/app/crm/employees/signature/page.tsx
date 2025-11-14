'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  User,
  Mail,
  Phone,
  Globe,
  Image,
  Eye,
  Save,
  RefreshCw,
  Copy,
  ArrowLeft,
} from 'lucide-react';
import { generateEmailSignature } from '@/components/crm/EmailSignatureGenerator';
import { useRouter } from 'next/navigation';

export default function SignatureCreatorPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [employee, setEmployee] = useState<any>(null);
  const [signature, setSignature] = useState({
    full_name: '',
    position: '',
    phone: '',
    email: '',
    website: 'https://mavinci.pl',
    avatar_url: '',
    custom_html: '',
    use_custom_html: false,
  });
  const [previewHtml, setPreviewHtml] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchEmployeeData();
  }, []);

  useEffect(() => {
    generatePreview();
  }, [signature]);

  const fetchEmployeeData = async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: empData } = await supabase
        .from('employees')
        .select('*')
        .eq('id', user.id)
        .single();

      if (empData) {
        setEmployee(empData);

        const { data: sigData } = await supabase
          .from('employee_signatures')
          .select('*')
          .eq('employee_id', user.id)
          .maybeSingle();

        if (sigData) {
          setSignature(sigData);
        } else {
          setSignature({
            full_name: `${empData.name} ${empData.surname}`,
            position: empData.occupation || '',
            phone: empData.phone_number || '',
            email: empData.email || '',
            website: 'https://mavinci.pl',
            avatar_url: empData.avatar_url,
            custom_html: '',
            use_custom_html: false,
          });
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    }
    setLoading(false);
  };

  const generatePreview = () => {
    if (signature.use_custom_html && signature.custom_html) {
      setPreviewHtml(signature.custom_html);
      return;
    }

    if (!signature.email || !signature.full_name) {
      setPreviewHtml(
        '<p style="color: #999; padding: 20px; text-align: center;">Wypełnij imię, nazwisko i email aby zobaczyć podgląd</p>',
      );
      return;
    }

    const html = generateEmailSignature({
      full_name: signature.full_name,
      position: signature.position,
      phone: signature.phone,
      email: signature.email,
      avatar_url: signature.avatar_url,
      website: signature.website,
    });

    setPreviewHtml(html);
  };

  const handleCopyHtml = () => {
    navigator.clipboard.writeText(previewHtml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.from('employee_signatures').upsert({
        employee_id: user.id,
        ...signature,
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;

      alert('Stopka została zapisana!');
    } catch (error) {
      console.error('Error saving signature:', error);
      alert('Błąd podczas zapisywania stopki');
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1119]">
        <RefreshCw className="h-8 w-8 animate-spin text-[#d3bb73]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="mb-4 flex items-center gap-2 text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <ArrowLeft className="h-5 w-5" />
            Powrót
          </button>
          <h1 className="mb-2 text-3xl font-bold text-white">Kreator Stopki Email</h1>
          <p className="text-[#e5e4e2]/60">
            Stwórz profesjonalną stopkę dla swoich wiadomości na podstawie szablonu
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
            <h2 className="mb-6 text-xl font-bold text-white">Ustawienia Stopki</h2>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/70">
                  <User className="mr-2 inline h-4 w-4" />
                  Imię i Nazwisko
                </label>
                <input
                  type="text"
                  value={signature.full_name}
                  onChange={(e) => setSignature({ ...signature, full_name: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/70">Stanowisko</label>
                <input
                  type="text"
                  value={signature.position}
                  onChange={(e) => setSignature({ ...signature, position: e.target.value })}
                  placeholder="np. Specjalista ds. Eventów"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/70">
                  <Mail className="mr-2 inline h-4 w-4" />
                  Email
                </label>
                <input
                  type="email"
                  value={signature.email}
                  onChange={(e) => setSignature({ ...signature, email: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/70">
                  <Phone className="mr-2 inline h-4 w-4" />
                  Telefon
                </label>
                <input
                  type="tel"
                  value={signature.phone}
                  onChange={(e) => setSignature({ ...signature, phone: e.target.value })}
                  placeholder="+48 123 456 789"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/70">
                  <Globe className="mr-2 inline h-4 w-4" />
                  Strona WWW
                </label>
                <input
                  type="url"
                  value={signature.website}
                  onChange={(e) => setSignature({ ...signature, website: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/70">
                  <Image className="mr-2 inline h-4 w-4" />
                  URL Avatara
                </label>
                <input
                  type="url"
                  value={signature.avatar_url}
                  onChange={(e) => setSignature({ ...signature, avatar_url: e.target.value })}
                  placeholder="https://example.com/avatar.jpg"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div className="border-t border-[#d3bb73]/20 pt-4">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={signature.use_custom_html}
                    onChange={(e) =>
                      setSignature({ ...signature, use_custom_html: e.target.checked })
                    }
                    className="h-5 w-5"
                  />
                  <span className="text-white">Użyj własnego HTML</span>
                </label>
              </div>

              {signature.use_custom_html && (
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/70">Własny HTML</label>
                  <textarea
                    value={signature.custom_html}
                    onChange={(e) => setSignature({ ...signature, custom_html: e.target.value })}
                    rows={8}
                    placeholder="<div>Twój HTML...</div>"
                    className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 font-mono text-sm text-white focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={saving}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-semibold text-[#1c1f33] transition-colors hover:bg-[#c5ad65] disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    Zapisywanie...
                  </>
                ) : (
                  <>
                    <Save className="h-5 w-5" />
                    Zapisz Stopkę
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">
                <Eye className="mr-2 inline h-5 w-5" />
                Podgląd
              </h2>
              <button
                onClick={handleCopyHtml}
                className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/20 px-4 py-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30"
              >
                <Copy className="h-4 w-4" />
                {copied ? 'Skopiowano!' : 'Kopiuj HTML'}
              </button>
            </div>

            <div className="max-h-[600px] overflow-auto rounded-lg bg-white p-6">
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>

            <div className="mt-6 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-4">
              <p className="mb-2 text-sm font-semibold text-[#e5e4e2]/70">Jak użyć tej stopki:</p>
              <ul className="list-inside list-disc space-y-1 text-sm text-[#e5e4e2]/60">
                <li>Kliknij "Kopiuj HTML" aby skopiować kod stopki</li>
                <li>Przejdź do zakładki "Konta Email" w swoim profilu</li>
                <li>Wklej skopiowany kod w polu "Podpis email (HTML)"</li>
                <li>Stopka będzie automatycznie dodawana do każdej wiadomości</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
