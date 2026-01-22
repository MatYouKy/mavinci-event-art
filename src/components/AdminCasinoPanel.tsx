'use client';

import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Save, Image as ImageIcon, ArrowUp, ArrowDown } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

interface AdminCasinoPanelProps {
  onClose: () => void;
}

export default function AdminCasinoPanel({ onClose }: AdminCasinoPanelProps) {
  const [activeTab, setActiveTab] = useState<
    'popup' | 'tables' | 'features' | 'gallery' | 'rules' | 'blocks'
  >('popup');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [popup, setPopup] = useState({ content: '', is_active: true });
  const [tables, setTables] = useState<any[]>([]);
  const [features, setFeatures] = useState<any[]>([]);
  const [gallery, setGallery] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [blocks, setBlocks] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const { data: popupData } = await supabase.from('casino_legal_popup').select('*').single();
    if (popupData) setPopup(popupData);

    const { data: tablesData } = await supabase
      .from('casino_tables')
      .select('*')
      .order('order_index');
    if (tablesData) setTables(tablesData);

    const { data: featuresData } = await supabase
      .from('casino_features')
      .select('*')
      .order('order_index');
    if (featuresData) setFeatures(featuresData);

    const { data: galleryData } = await supabase
      .from('casino_gallery')
      .select('*')
      .order('order_index');
    if (galleryData) setGallery(galleryData);

    const { data: rulesData } = await supabase
      .from('casino_game_rules')
      .select('*')
      .order('order_index');
    if (rulesData) setRules(rulesData);

    const { data: blocksData } = await supabase
      .from('casino_content_blocks')
      .select('*')
      .order('order_index');
    if (blocksData) setBlocks(blocksData);
  };

  const showMessage = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  const savePopup = async () => {
    setLoading(true);
    const { error } = await supabase.from('casino_legal_popup').upsert(popup);
    if (error) {
      showMessage('Błąd: ' + error.message);
    } else {
      showMessage('Popup zapisany!');
    }
    setLoading(false);
  };

  const saveTables = async () => {
    setLoading(true);
    for (const table of tables) {
      await supabase.from('casino_tables').upsert(table);
    }
    showMessage('Stoły zapisane!');
    setLoading(false);
  };

  const addTable = () => {
    setTables([
      ...tables,
      {
        id: crypto.randomUUID(),
        name: 'Nowy stół',
        slug: 'nowy-stol-' + Date.now(),
        description: '',
        image_url: '',
        image_alt: '',
        order_index: tables.length,
        is_visible: true,
      },
    ]);
  };

  const deleteTable = async (id: string) => {
    await supabase.from('casino_tables').delete().eq('id', id);
    setTables(tables.filter((t) => t.id !== id));
    showMessage('Stół usunięty');
  };

  const moveItem = (items: any[], setItems: any, index: number, direction: 'up' | 'down') => {
    const newItems = [...items];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newItems.length) return;

    [newItems[index], newItems[targetIndex]] = [newItems[targetIndex], newItems[index]];
    newItems.forEach((item, idx) => (item.order_index = idx));
    setItems(newItems);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm">
      <div className="min-h-screen p-4">
        <div className="mx-auto max-w-6xl rounded-2xl border border-[#d3bb73]/30 bg-[#1c1f33] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
            <h2 className="text-2xl font-light text-[#e5e4e2]">Zarządzanie stroną Kasyno</h2>
            <button onClick={onClose} className="text-[#d3bb73] hover:text-[#d3bb73]/80">
              <X className="h-6 w-6" />
            </button>
          </div>

          {message && (
            <div className="mx-6 mt-4 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/20 p-3 text-sm text-[#e5e4e2]">
              {message}
            </div>
          )}

          <div className="flex gap-2 overflow-x-auto border-b border-[#d3bb73]/20 p-4">
            {[
              { key: 'popup', label: 'Popup Prawny' },
              { key: 'tables', label: 'Stoły' },
              { key: 'features', label: 'Features' },
              { key: 'gallery', label: 'Galeria' },
              { key: 'rules', label: 'Zasady' },
              { key: 'blocks', label: 'Bloki' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'bg-[#d3bb73]/10 text-[#d3bb73] hover:bg-[#d3bb73]/20'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {activeTab === 'popup' && (
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Treść popup'u prawnego
                  </label>
                  <textarea
                    value={popup.content}
                    onChange={(e) => setPopup({ ...popup, content: e.target.value })}
                    rows={12}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={popup.is_active}
                    onChange={(e) => setPopup({ ...popup, is_active: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <label className="text-sm text-[#e5e4e2]">Aktywny</label>
                </div>
                <button
                  onClick={savePopup}
                  disabled={loading}
                  className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  Zapisz
                </button>
              </div>
            )}

            {activeTab === 'tables' && (
              <div className="space-y-6">
                <button
                  onClick={addTable}
                  className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
                >
                  <Plus className="h-4 w-4" />
                  Dodaj stół
                </button>

                {tables.map((table, index) => (
                  <div
                    key={table.id}
                    className="space-y-3 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-4"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-[#e5e4e2]">Stół #{index + 1}</h3>
                      <div className="flex gap-2">
                        <button
                          onClick={() => moveItem(tables, setTables, index, 'up')}
                          className="text-[#d3bb73] hover:text-[#d3bb73]/80"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => moveItem(tables, setTables, index, 'down')}
                          className="text-[#d3bb73] hover:text-[#d3bb73]/80"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => deleteTable(table.id)}
                          className="text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      placeholder="Nazwa"
                      value={table.name}
                      onChange={(e) => {
                        const newTables = [...tables];
                        newTables[index].name = e.target.value;
                        setTables(newTables);
                      }}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-2 text-[#e5e4e2]"
                    />
                    <input
                      type="text"
                      placeholder="URL zdjęcia"
                      value={table.image_url}
                      onChange={(e) => {
                        const newTables = [...tables];
                        newTables[index].image_url = e.target.value;
                        setTables(newTables);
                      }}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-2 text-[#e5e4e2]"
                    />
                    <textarea
                      placeholder="Opis"
                      value={table.description}
                      onChange={(e) => {
                        const newTables = [...tables];
                        newTables[index].description = e.target.value;
                        setTables(newTables);
                      }}
                      rows={3}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-2 text-[#e5e4e2]"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={table.is_visible}
                        onChange={(e) => {
                          const newTables = [...tables];
                          newTables[index].is_visible = e.target.checked;
                          setTables(newTables);
                        }}
                        className="h-4 w-4"
                      />
                      <label className="text-sm text-[#e5e4e2]">Widoczny</label>
                    </div>
                  </div>
                ))}

                <button
                  onClick={saveTables}
                  disabled={loading}
                  className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  Zapisz wszystkie stoły
                </button>
              </div>
            )}

            {activeTab === 'features' && (
              <div className="text-[#e5e4e2]">
                <p className="mb-4 text-sm text-[#e5e4e2]/60">Funkcjonalność w przygotowaniu...</p>
              </div>
            )}

            {activeTab === 'gallery' && (
              <div className="text-[#e5e4e2]">
                <p className="mb-4 text-sm text-[#e5e4e2]/60">Funkcjonalność w przygotowaniu...</p>
              </div>
            )}

            {activeTab === 'rules' && (
              <div className="text-[#e5e4e2]">
                <p className="mb-4 text-sm text-[#e5e4e2]/60">Funkcjonalność w przygotowaniu...</p>
              </div>
            )}

            {activeTab === 'blocks' && (
              <div className="text-[#e5e4e2]">
                <p className="mb-4 text-sm text-[#e5e4e2]/60">Funkcjonalność w przygotowaniu...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
