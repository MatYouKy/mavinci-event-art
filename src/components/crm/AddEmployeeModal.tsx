'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface AddEmployeeModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

interface AccessLevel {
  id: string;
  name: string;
  description: string | null;
}

export default function AddEmployeeModal({ onClose, onSuccess }: AddEmployeeModalProps) {
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [accessLevels, setAccessLevels] = useState<AccessLevel[]>([]);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
    surname: '',
    nickname: '',
    phone_number: '',
    role: 'unassigned',
    access_level_id: '',
    occupation: '',
  });
  const [error, setError] = useState('');

  useEffect(() => {
    fetchAccessLevels();
  }, []);

  const fetchAccessLevels = async () => {
    try {
      const { data, error } = await supabase
        .from('access_levels')
        .select('id, name, description')
        .order('name');

      if (error) throw error;
      setAccessLevels(data || []);
    } catch (err: any) {
      console.error('Error fetching access levels:', err);
    }
  };

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setFormData(prev => ({ ...prev, password }));
    setShowPassword(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Validate required fields
      if (!formData.email || !formData.password || !formData.name || !formData.surname) {
        setError('Wypełnij wszystkie wymagane pola');
        setLoading(false);
        return;
      }

      // Get current session
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        throw new Error('Brak sesji użytkownika');
      }

      // Get Supabase URL from environment
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

      if (!supabaseUrl) {
        throw new Error('Missing Supabase configuration');
      }

      // Call edge function to create employee with user token
      const response = await fetch(`${supabaseUrl}/functions/v1/create-employee`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Nie udało się utworzyć pracownika');
      }

      // Show success message with credentials info
      alert(
        `✅ Pracownik został utworzony pomyślnie!\n\n` +
        `Email: ${formData.email}\n` +
        `Hasło: ${formData.password}\n\n` +
        `⚠️ Zapisz te dane i przekaż je pracownikowi!\n` +
        `Pracownik może zmienić hasło po pierwszym logowaniu.`
      );

      // Success
      onSuccess();
    } catch (err: any) {
      console.error('Error creating employee:', err);
      setError(err.message || 'Wystąpił błąd podczas tworzenia pracownika');
    } finally {
      setLoading(false);
    }
  };

  const roles = [
    { value: 'admin', label: 'Administrator' },
    { value: 'manager', label: 'Menedżer' },
    { value: 'event_manager', label: 'Menedżer eventów' },
    { value: 'sales', label: 'Sprzedaż' },
    { value: 'logistics', label: 'Logistyka' },
    { value: 'technician', label: 'Technik' },
    { value: 'support', label: 'Wsparcie' },
    { value: 'freelancer', label: 'Freelancer' },
    { value: 'dj', label: 'DJ' },
    { value: 'mc', label: 'Konferansjer' },
    { value: 'assistant', label: 'Asystent' },
    { value: 'unassigned', label: 'Nieprzypisany' },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-medium text-[#e5e4e2]">
            Dodaj nowego pracownika
          </h3>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Imię <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full bg-[#0f1019] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Nazwisko <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.surname}
                onChange={(e) => setFormData(prev => ({ ...prev, surname: e.target.value }))}
                className="w-full bg-[#0f1019] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
              Pseudonim / Nick
            </label>
            <input
              type="text"
              value={formData.nickname}
              onChange={(e) => setFormData(prev => ({ ...prev, nickname: e.target.value }))}
              className="w-full bg-[#0f1019] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Email <span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                className="w-full bg-[#0f1019] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Telefon
              </label>
              <input
                type="tel"
                value={formData.phone_number}
                onChange={(e) => setFormData(prev => ({ ...prev, phone_number: e.target.value }))}
                className="w-full bg-[#0f1019] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
              Hasło <span className="text-red-400">*</span>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full bg-[#0f1019] border border-[#d3bb73]/20 rounded-lg px-3 py-2 pr-10 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                type="button"
                onClick={generateRandomPassword}
                className="px-3 py-2 bg-[#d3bb73]/20 hover:bg-[#d3bb73]/30 border border-[#d3bb73]/30 text-[#e5e4e2] rounded-lg text-sm transition-colors whitespace-nowrap"
              >
                Generuj
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Rola
              </label>
              <select
                value={formData.role}
                onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                className="w-full bg-[#0f1019] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
              >
                {roles.map(role => (
                  <option key={role.value} value={role.value}>{role.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Poziom dostępu
              </label>
              <select
                value={formData.access_level_id}
                onChange={(e) => setFormData(prev => ({ ...prev, access_level_id: e.target.value }))}
                className="w-full bg-[#0f1019] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
              >
                <option value="">Wybierz poziom dostępu</option>
                {accessLevels.map(level => (
                  <option key={level.id} value={level.id}>{level.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
              Stanowisko
            </label>
            <input
              type="text"
              value={formData.occupation}
              onChange={(e) => setFormData(prev => ({ ...prev, occupation: e.target.value }))}
              className="w-full bg-[#0f1019] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
              placeholder="np. Kierownik projektu, Technik audio"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-[#d3bb73]/30 text-[#e5e4e2] rounded-lg hover:bg-[#d3bb73]/10 transition-colors"
              disabled={loading}
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-[#d3bb73] hover:bg-[#d3bb73]/90 text-[#0f1019] font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Tworzenie...' : 'Utwórz pracownika'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
