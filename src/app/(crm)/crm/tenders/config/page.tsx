'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/browser';
import Link from 'next/link';
import { Save, Plus, Trash2, Settings, Tag, MapPin, Gauge, Clock, CircleX, CircleCheck, X, ArrowLeft } from 'lucide-react';

interface FilterConfig {
  id: string;
  name: string;
  positive_keywords: string[];
  negative_keywords: string[];
  cpv_codes: string[];
  locations: string[];
  sources: string[];
  min_relevance_score: number;
  max_days_to_deadline: number;
  is_active: boolean;
}

export default function FilterConfigPage() {
  const [configs, setConfigs] = useState<FilterConfig[]>([]);
  const [selected, setSelected] = useState<FilterConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [newKeyword, setNewKeyword] = useState('');
  const [newNegKeyword, setNewNegKeyword] = useState('');
  const [newCpv, setNewCpv] = useState('');
  const [newLocation, setNewLocation] = useState('');

  useEffect(() => {
    fetchConfigs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchConfigs = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('tender_filter_config')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) {
      setConfigs(data);
      if (data.length > 0 && !selected) setSelected(data[0]);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    setMessage(null);

    const { error } = await supabase
      .from('tender_filter_config')
      .update({
        name: selected.name,
        positive_keywords: selected.positive_keywords,
        negative_keywords: selected.negative_keywords,
        cpv_codes: selected.cpv_codes,
        locations: selected.locations,
        sources: selected.sources,
        min_relevance_score: selected.min_relevance_score,
        max_days_to_deadline: selected.max_days_to_deadline,
        is_active: selected.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', selected.id);

    if (error) {
      setMessage({ type: 'error', text: error.message });
    } else {
      setMessage({ type: 'success', text: 'Konfiguracja zapisana' });
      fetchConfigs();
    }
    setSaving(false);
  };

  const handleCreate = async () => {
    const { data } = await supabase
      .from('tender_filter_config')
      .insert({ name: 'Nowa konfiguracja', is_active: false })
      .select()
      .single();

    if (data) {
      setConfigs((prev) => [data, ...prev]);
      setSelected(data);
    }
  };

  const handleDelete = async () => {
    if (!selected || !confirm('Czy na pewno usunąć tę konfigurację?')) return;
    await supabase.from('tender_filter_config').delete().eq('id', selected.id);
    setSelected(null);
    fetchConfigs();
  };

  const addItem = (field: 'positive_keywords' | 'negative_keywords' | 'cpv_codes' | 'locations', value: string) => {
    if (!selected || !value.trim()) return;
    setSelected({
      ...selected,
      [field]: [...selected[field], value.trim()],
    });
  };

  const removeItem = (field: 'positive_keywords' | 'negative_keywords' | 'cpv_codes' | 'locations', index: number) => {
    if (!selected) return;
    setSelected({
      ...selected,
      [field]: selected[field].filter((_, i) => i !== index),
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#d3bb73] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href="/crm/tenders"
            className="mb-2 inline-flex items-center gap-1.5 text-xs text-[#e5e4e2]/40 hover:text-[#e5e4e2]/70"
          >
            <ArrowLeft className="h-3 w-3" /> Wróć do przetargów
          </Link>
          <h1 className="text-2xl font-light text-[#e5e4e2]">Konfiguracja filtrów</h1>
          <p className="mt-1 text-sm text-[#e5e4e2]/50">
            Definiuj kryteria dopasowania przetargów do profilu firmy
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" /> Nowa konfiguracja
        </button>
      </div>

      {message && (
        <div className={`mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
          message.type === 'success'
            ? 'border-green-500/30 bg-green-500/10 text-green-400'
            : 'border-red-500/30 bg-red-500/10 text-red-400'
        }`}>
          {message.type === 'success' ? <CircleCheck className="h-4 w-4" /> : <CircleX className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      <div className="flex gap-6">
        <div className="w-64 flex-shrink-0 space-y-2">
          {configs.map((cfg) => (
            <button
              key={cfg.id}
              onClick={() => setSelected(cfg)}
              className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                selected?.id === cfg.id
                  ? 'border-[#d3bb73]/40 bg-[#d3bb73]/10'
                  : 'border-[#d3bb73]/10 bg-[#1c1f33] hover:border-[#d3bb73]/20'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#e5e4e2]">{cfg.name}</span>
                {cfg.is_active && (
                  <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] text-green-400">
                    Aktywna
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>

        {selected && (
          <div className="flex-1 space-y-5">
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
              <div className="mb-4 flex items-center gap-3">
                <Settings className="h-5 w-5 text-[#d3bb73]" />
                <h2 className="text-base font-medium text-[#e5e4e2]">Ustawienia podstawowe</h2>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs text-[#e5e4e2]/50">Nazwa konfiguracji</label>
                  <input
                    type="text"
                    value={selected.name}
                    onChange={(e) => setSelected({ ...selected, name: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs text-[#e5e4e2]/50">
                    <Gauge className="h-3 w-3" /> Minimalna ocena trafności
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={selected.min_relevance_score}
                    onChange={(e) => setSelected({ ...selected, min_relevance_score: Number(e.target.value) })}
                    className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 flex items-center gap-1.5 text-xs text-[#e5e4e2]/50">
                    <Clock className="h-3 w-3" /> Max dni do terminu
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={selected.max_days_to_deadline}
                    onChange={(e) => setSelected({ ...selected, max_days_to_deadline: Number(e.target.value) })}
                    className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                    <input
                      type="checkbox"
                      checked={selected.is_active}
                      onChange={(e) => setSelected({ ...selected, is_active: e.target.checked })}
                      className="rounded border-[#d3bb73]/30 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73]/30"
                    />
                    Konfiguracja aktywna
                  </label>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
              <div className="mb-4 flex items-center gap-3">
                <Tag className="h-5 w-5 text-green-400" />
                <h2 className="text-base font-medium text-[#e5e4e2]">Słowa kluczowe (pozytywne)</h2>
              </div>
              <div className="mb-3 flex gap-2">
                <input
                  type="text"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      addItem('positive_keywords', newKeyword);
                      setNewKeyword('');
                    }
                  }}
                  placeholder="Dodaj słowo kluczowe..."
                  className="flex-1 rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:border-[#d3bb73]/40 focus:outline-none"
                />
                <button
                  onClick={() => { addItem('positive_keywords', newKeyword); setNewKeyword(''); }}
                  className="rounded-lg bg-green-500/20 px-3 py-2 text-sm text-green-400 hover:bg-green-500/30"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selected.positive_keywords.map((kw, i) => (
                  <span key={i} className="flex items-center gap-1 rounded-lg border border-green-500/20 bg-green-500/10 px-2 py-1 text-xs text-green-400">
                    {kw}
                    <button onClick={() => removeItem('positive_keywords', i)} className="ml-1 hover:text-white">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
              <div className="mb-4 flex items-center gap-3">
                <Tag className="h-5 w-5 text-red-400" />
                <h2 className="text-base font-medium text-[#e5e4e2]">Słowa wykluczające</h2>
              </div>
              <div className="mb-3 flex gap-2">
                <input
                  type="text"
                  value={newNegKeyword}
                  onChange={(e) => setNewNegKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      addItem('negative_keywords', newNegKeyword);
                      setNewNegKeyword('');
                    }
                  }}
                  placeholder="Dodaj frazę wykluczającą..."
                  className="flex-1 rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:border-[#d3bb73]/40 focus:outline-none"
                />
                <button
                  onClick={() => { addItem('negative_keywords', newNegKeyword); setNewNegKeyword(''); }}
                  className="rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-400 hover:bg-red-500/30"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selected.negative_keywords.map((kw, i) => (
                  <span key={i} className="flex items-center gap-1 rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-red-400">
                    {kw}
                    <button onClick={() => removeItem('negative_keywords', i)} className="ml-1 hover:text-white">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
              <div className="mb-4 flex items-center gap-3">
                <Tag className="h-5 w-5 text-[#d3bb73]" />
                <h2 className="text-base font-medium text-[#e5e4e2]">Kody CPV</h2>
              </div>
              <div className="mb-3 flex gap-2">
                <input
                  type="text"
                  value={newCpv}
                  onChange={(e) => setNewCpv(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      addItem('cpv_codes', newCpv);
                      setNewCpv('');
                    }
                  }}
                  placeholder="np. 79952000-2"
                  className="flex-1 rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:border-[#d3bb73]/40 focus:outline-none"
                />
                <button
                  onClick={() => { addItem('cpv_codes', newCpv); setNewCpv(''); }}
                  className="rounded-lg bg-[#d3bb73]/20 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/30"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selected.cpv_codes.map((cpv, i) => (
                  <span key={i} className="flex items-center gap-1 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-2 py-1 text-xs text-[#d3bb73]">
                    {cpv}
                    <button onClick={() => removeItem('cpv_codes', i)} className="ml-1 hover:text-white">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
              <div className="mb-4 flex items-center gap-3">
                <MapPin className="h-5 w-5 text-blue-400" />
                <h2 className="text-base font-medium text-[#e5e4e2]">Lokalizacje</h2>
              </div>
              <div className="mb-3 flex gap-2">
                <input
                  type="text"
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      addItem('locations', newLocation);
                      setNewLocation('');
                    }
                  }}
                  placeholder="np. Warszawa, małopolskie..."
                  className="flex-1 rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:border-[#d3bb73]/40 focus:outline-none"
                />
                <button
                  onClick={() => { addItem('locations', newLocation); setNewLocation(''); }}
                  className="rounded-lg bg-blue-500/20 px-3 py-2 text-sm text-blue-400 hover:bg-blue-500/30"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selected.locations.map((loc, i) => (
                  <span key={i} className="flex items-center gap-1 rounded-lg border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-xs text-blue-400">
                    {loc}
                    <button onClick={() => removeItem('locations', i)} className="ml-1 hover:text-white">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={handleDelete}
                className="flex items-center gap-2 rounded-lg border border-red-500/20 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="h-4 w-4" /> Usuń konfigurację
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Zapisywanie...' : 'Zapisz konfigurację'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
