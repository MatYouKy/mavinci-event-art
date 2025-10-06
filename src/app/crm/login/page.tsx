'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function CRMLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }

      if (data.session) {
        router.push('/crm');
      }
    } catch (err: any) {
      setError(err.message || 'Wystąpił błąd podczas logowania');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1119] flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-2xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#d3bb73]/10 mb-4">
              <Lock className="w-8 h-8 text-[#d3bb73]" />
            </div>
            <h2 className="text-3xl font-light text-[#e5e4e2] mb-2">
              Panel CRM Mavinci
            </h2>
            <p className="text-[#e5e4e2]/60 font-light">
              Zaloguj się aby zarządzać systemem
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-light text-[#e5e4e2] mb-2"
              >
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#d3bb73]/60" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="twoj@email.pl"
                  required
                  className="w-full pl-10 pr-4 py-3 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none transition-colors"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-light text-[#e5e4e2] mb-2"
              >
                Hasło
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#d3bb73]/60" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-10 pr-4 py-3 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none transition-colors"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-red-400 text-sm text-center">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Logowanie...' : 'Zaloguj się'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-[#e5e4e2]/60">
            <p>
              Skontaktuj się z administratorem aby uzyskać dostęp
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
