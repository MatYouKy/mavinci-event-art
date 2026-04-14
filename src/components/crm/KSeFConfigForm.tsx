'use client';

import { useState, useEffect } from 'react';
import {
  Save,
  TestTube,
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle,
  Loader2,
  Upload,
  FileKey,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface KSeFConfigFormProps {
  companyId: string;
  onUpdate?: () => void;
}

export default function KSeFConfigForm({ companyId, onUpdate }: KSeFConfigFormProps) {
  const [nip, setNip] = useState('');
  const [token, setToken] = useState('');
  const [isTestEnv, setIsTestEnv] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [certificateKey, setCertificateKey] = useState('');
  const [certificatePassword, setCertificatePassword] = useState('');
  const [showCertPassword, setShowCertPassword] = useState(false);
  const [hasCertificate, setHasCertificate] = useState(false);
  const [certificateUploadedAt, setCertificateUploadedAt] = useState<string | null>(null);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    loadCredentials();
  }, [companyId]);

  const loadCredentials = async () => {
    try {
      setLoading(true);

      const { data: company, error: companyError } = await supabase
        .from('my_companies')
        .select('nip')
        .eq('id', companyId)
        .single();

      if (companyError) throw companyError;

      setNip(company.nip);

      const { data: credentials, error: credError } = await supabase
        .from('ksef_credentials')
        .select('*')
        .eq('my_company_id', companyId)
        .maybeSingle();

      if (credError && credError.code !== 'PGRST116') throw credError;

      if (credentials) {
        setHasCredentials(true);
        setIsTestEnv(credentials.is_test_environment || false);
        setHasCertificate(!!credentials.certificate_key);
        setCertificateUploadedAt(credentials.certificate_uploaded_at);
      } else {
        setHasCredentials(false);
        setHasCertificate(false);
      }
    } catch (err) {
      console.error('Error loading credentials:', err);
      showSnackbar('Błąd podczas wczytywania danych', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();

      if (!text.includes('BEGIN ENCRYPTED PRIVATE KEY') && !text.includes('BEGIN PRIVATE KEY')) {
        showSnackbar('Nieprawidłowy format pliku. Oczekiwano klucza PEM (.key)', 'error');
        return;
      }

      setCertificateKey(text);
      showSnackbar('Plik certyfikatu został wczytany', 'success');
    } catch (err) {
      console.error('Error reading file:', err);
      showSnackbar('Błąd podczas wczytywania pliku', 'error');
    }
  };

  const handleSave = async () => {
    const normalizedToken = token.trim();

    if (!normalizedToken) {
      showSnackbar('Wypełnij token autoryzacyjny', 'error');
      return;
    }

    if (certificateKey && !certificatePassword) {
      showSnackbar('Podaj hasło do klucza prywatnego', 'error');
      return;
    }

    try {
      setSaving(true);

      const normalizedToken = token.trim();

      const updateData: any = {
        token: normalizedToken,
        is_test_environment: isTestEnv,
        updated_at: new Date().toISOString(),
      };

      if (certificateKey && certificatePassword) {
        updateData.certificate_key = certificateKey;
        updateData.certificate_password = certificatePassword;
        updateData.certificate_uploaded_at = new Date().toISOString();
      }

      if (hasCredentials) {
        const { error } = await supabase
          .from('ksef_credentials')
          .update(updateData)
          .eq('my_company_id', companyId);

        if (error) throw error;
      } else {
        const insertData = {
          my_company_id: companyId,
          nip: nip,
          is_active: true,
          ...updateData,
        };

        const { error } = await supabase.from('ksef_credentials').insert(insertData);

        if (error) throw error;
      }

      showSnackbar('Konfiguracja KSeF została zapisana', 'success');

      
      setHasCredentials(true);
      if (certificateKey) {
        setHasCertificate(true);
        setCertificateUploadedAt(new Date().toISOString());
        setCertificateKey('');
        setCertificatePassword('');
      }

      setTestResult(null);
      await loadCredentials();
      
      onUpdate?.();
    } catch (err: any) {
      console.error('Error saving credentials:', err);
      showSnackbar(err.message || 'Błąd podczas zapisywania konfiguracji', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!hasCredentials) {
      showSnackbar('Najpierw zapisz konfigurację', 'error');
      return;
    }

    try {
      setTesting(true);
      setTestResult(null);

      const response = await fetch('/bridge/ksef/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });

      const result = await response.json();

      if (result.success) {
        setTestResult('success');
        showSnackbar('Połączenie z KSeF działa poprawnie', 'success');
      } else {
        setTestResult('error');
        showSnackbar(result.error || 'Błąd połączenia z KSeF', 'error');
      }
    } catch (err) {
      console.error('Error testing connection:', err);
      setTestResult('error');
      showSnackbar('Błąd podczas testowania połączenia', 'error');
    } finally {
      setTesting(false);
    }
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-[#d3bb73]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
          NIP firmy
          <span className="ml-2 text-xs text-[#e5e4e2]/60">(pobrano automatycznie)</span>
        </label>
        <input
          type="text"
          value={nip}
          disabled
          className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#0f1119]/50 px-4 py-3 text-[#e5e4e2]/60"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
          Token autoryzacyjny <span className="text-red-400">*</span>
        </label>
        <div className="relative">
          <input
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={hasCredentials ? '••••••••••••••••' : 'Wklej token z platformy KSeF'}
            className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#0f1119] px-4 py-3 pr-12 text-[#e5e4e2] placeholder:text-[#e5e4e2]/30 focus:border-[#d3bb73] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/40 transition-colors hover:text-[#e5e4e2]"
          >
            {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-2 text-xs text-[#e5e4e2]/60">
          Token należy wygenerować w panelu KSeF (Ustawienia → Tokeny)
        </p>
      </div>

      <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <div className="mb-4 flex items-start gap-3">
          <FileKey className="mt-1 h-5 w-5 text-[#d3bb73]" />
          <div className="flex-1">
            <h3 className="font-medium text-[#e5e4e2]">Certyfikat kwalifikowany</h3>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              Prześlij klucz prywatny (.key) i hasło do bezpiecznego przechowania w systemie
            </p>
          </div>
        </div>

        {hasCertificate && certificateUploadedAt && (
          <div className="mb-4 rounded-lg border border-green-500/20 bg-green-500/5 p-3">
            <div className="flex items-center gap-2 text-sm text-green-400">
              <CheckCircle className="h-4 w-4" />
              <span>
                Certyfikat przesłany{' '}
                {new Date(certificateUploadedAt).toLocaleDateString('pl-PL', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
              Klucz prywatny (.key)
            </label>
            <div className="relative">
              <input
                type="file"
                accept=".key,.pem"
                onChange={handleFileUpload}
                className="hidden"
                id="cert-upload"
              />
              <label
                htmlFor="cert-upload"
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#0f1119] px-4 py-3 text-[#e5e4e2] transition-colors hover:border-[#d3bb73]"
              >
                <Upload className="h-4 w-4" />
                {certificateKey ? 'Plik wczytany ✓' : 'Wybierz plik .key lub .pem'}
              </label>
            </div>
            <p className="mt-2 text-xs text-[#e5e4e2]/60">
              Plik zawierający -----BEGIN ENCRYPTED PRIVATE KEY-----
            </p>
          </div>

          {certificateKey && (
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Hasło do klucza prywatnego
              </label>
              <div className="relative">
                <input
                  type={showCertPassword ? 'text' : 'password'}
                  value={certificatePassword}
                  onChange={(e) => setCertificatePassword(e.target.value)}
                  placeholder="Wprowadź hasło do certyfikatu"
                  className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#0f1119] px-4 py-3 pr-12 text-[#e5e4e2] placeholder:text-[#e5e4e2]/30 focus:border-[#d3bb73] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowCertPassword(!showCertPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/40 transition-colors hover:text-[#e5e4e2]"
                >
                  {showCertPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {certificateKey && certificatePassword && (
            <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
              <div className="flex items-start gap-2 text-xs text-green-400">
                <CheckCircle className="mt-0.5 h-3 w-3" />
                <span>
                  Certyfikat i hasło zostaną bezpiecznie zapisane w bazie danych. Nie będziesz
                  musiał podawać ich ponownie przy każdym wysyłaniu faktury.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
          <input
            type="checkbox"
            checked={isTestEnv}
            onChange={(e) => setIsTestEnv(e.target.checked)}
            className="h-5 w-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50"
          />
          <div>
            <div className="font-medium text-[#e5e4e2]">Środowisko testowe</div>
            <div className="text-xs text-[#e5e4e2]/60">
              Zaznacz, jeśli używasz testowej wersji platformy KSeF
            </div>
          </div>
        </label>
      </div>

      {testResult && (
        <div
          className={`flex items-center gap-3 rounded-lg border p-4 ${
            testResult === 'success'
              ? 'border-green-500/20 bg-green-500/5 text-green-400'
              : 'border-red-500/20 bg-red-500/5 text-red-400'
          }`}
        >
          {testResult === 'success' ? (
            <CheckCircle className="h-5 w-5" />
          ) : (
            <AlertCircle className="h-5 w-5" />
          )}
          <div className="text-sm">
            {testResult === 'success'
              ? 'Połączenie z KSeF działa poprawnie'
              : 'Błąd połączenia z KSeF - sprawdź dane'}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving || testing}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Zapisywanie...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Zapisz konfigurację
            </>
          )}
        </button>

        {hasCredentials && (
          <button
            onClick={handleTest}
            disabled={saving || testing}
            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#0f1119] px-6 py-3 text-[#e5e4e2] transition-colors hover:bg-[#1c1f33] disabled:opacity-50"
          >
            {testing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Testowanie...
              </>
            ) : (
              <>
                <TestTube className="h-4 w-4" />
                Testuj połączenie
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
