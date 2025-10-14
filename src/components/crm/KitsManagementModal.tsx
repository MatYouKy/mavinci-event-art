'use client';

import { useState, useEffect } from 'react';
import { Plus, X, Trash2, Package, Search, Edit, Eye, Printer, Copy } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/lib/storage';

interface EquipmentUnit {
  id: string;
  status: 'available' | 'damaged' | 'in_service' | 'retired';
}

interface Equipment {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  thumbnail_url: string | null;
  equipment_units?: EquipmentUnit[];
}

interface KitItem {
  id: string;
  equipment_id: string;
  quantity: number;
  notes: string | null;
  order_index: number;
  equipment_items: Equipment;
}

interface Kit {
  id: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  is_active: boolean;
  created_at: string;
  equipment_kit_items: KitItem[];
}

export default function KitsManagementModal({
  onClose,
  equipment,
  initialKitId,
}: {
  onClose: () => void;
  equipment: Equipment[];
  initialKitId?: string | null;
}) {
  const [kits, setKits] = useState<Kit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [viewingKit, setViewingKit] = useState<Kit | null>(null);
  const [editingKit, setEditingKit] = useState<Kit | null>(null);
  const [kitForm, setKitForm] = useState({
    name: '',
    description: '',
    thumbnail_url: '',
  });
  const [kitItems, setKitItems] = useState<{equipment_id: string; quantity: number; notes: string}[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchKits();
  }, []);

  useEffect(() => {
    if (initialKitId && kits.length > 0) {
      const kit = kits.find(k => k.id === initialKitId);
      if (kit) {
        setViewingKit(kit);
      }
    }
  }, [initialKitId, kits]);

  const fetchKits = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('equipment_kits')
        .select(`
          *,
          equipment_kit_items(
            *,
            equipment_items(id, name, brand, model, thumbnail_url)
          )
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setKits(data || []);
    } catch (error) {
      console.error('Error fetching kits:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenForm = (kit?: Kit) => {
    if (kit) {
      setEditingKit(kit);
      setKitForm({
        name: kit.name,
        description: kit.description || '',
        thumbnail_url: kit.thumbnail_url || '',
      });
      setKitItems(kit.equipment_kit_items.map(item => ({
        equipment_id: item.equipment_id,
        quantity: item.quantity,
        notes: item.notes || '',
      })));
    } else {
      setEditingKit(null);
      setKitForm({
        name: '',
        description: '',
        thumbnail_url: '',
      });
      setKitItems([]);
    }
    setShowAddForm(true);
  };

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const url = await uploadImage(file, 'equipment-kits');
      setKitForm(prev => ({ ...prev, thumbnail_url: url }));
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Błąd podczas przesyłania zdjęcia');
    } finally {
      setUploading(false);
    }
  };

  const handleAddKitItem = (equipmentId: string) => {
    if (kitItems.some(item => item.equipment_id === equipmentId)) {
      alert('Ten sprzęt jest już w zestawie');
      return;
    }
    setKitItems([...kitItems, { equipment_id: equipmentId, quantity: 1, notes: '' }]);
  };

  const handleRemoveKitItem = (index: number) => {
    setKitItems(kitItems.filter((_, i) => i !== index));
  };

  const handleUpdateKitItem = (index: number, field: 'quantity' | 'notes', value: string | number) => {
    const updated = [...kitItems];
    if (field === 'quantity') {
      const newQty = typeof value === 'number' ? value : parseInt(value) || 1;
      const equipmentItem = equipment.find(e => e.id === updated[index].equipment_id);
      const availableQty = equipmentItem?.equipment_units?.filter(u => u.status === 'available').length || 0;

      if (newQty > availableQty) {
        alert(`Maksymalna dostępna ilość: ${availableQty} szt.`);
        return;
      }
      updated[index].quantity = newQty;
    } else {
      updated[index].notes = value as string;
    }
    setKitItems(updated);
  };

  const handleSaveKit = async () => {
    if (!kitForm.name.trim()) {
      alert('Nazwa zestawu jest wymagana');
      return;
    }

    if (kitItems.length === 0) {
      alert('Dodaj przynajmniej jedną pozycję do zestawu');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      let kitId = editingKit?.id;

      if (editingKit) {
        // Aktualizacja istniejącego zestawu
        const { error: updateError } = await supabase
          .from('equipment_kits')
          .update({
            name: kitForm.name,
            description: kitForm.description || null,
            thumbnail_url: kitForm.thumbnail_url || null,
          })
          .eq('id', editingKit.id);

        if (updateError) throw updateError;

        // Usuń stare pozycje
        const { error: deleteError } = await supabase
          .from('equipment_kit_items')
          .delete()
          .eq('kit_id', editingKit.id);

        if (deleteError) throw deleteError;
      } else {
        // Tworzenie nowego zestawu
        const { data: newKit, error: insertError } = await supabase
          .from('equipment_kits')
          .insert({
            name: kitForm.name,
            description: kitForm.description || null,
            thumbnail_url: kitForm.thumbnail_url || null,
            created_by: user?.id || null,
          })
          .select()
          .single();

        if (insertError) throw insertError;
        kitId = newKit.id;
      }

      // Dodaj nowe pozycje
      const itemsToInsert = kitItems.map((item, index) => ({
        kit_id: kitId,
        equipment_id: item.equipment_id,
        quantity: item.quantity,
        notes: item.notes || null,
        order_index: index,
      }));

      const { error: itemsError } = await supabase
        .from('equipment_kit_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      setShowAddForm(false);
      fetchKits();
    } catch (error) {
      console.error('Error saving kit:', error);
      alert('Błąd podczas zapisywania zestawu');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteKit = async (kitId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten zestaw?')) return;

    try {
      const { error } = await supabase
        .from('equipment_kits')
        .update({ is_active: false })
        .eq('id', kitId);

      if (error) throw error;
      fetchKits();
    } catch (error) {
      console.error('Error deleting kit:', error);
      alert('Błąd podczas usuwania zestawu');
    }
  };

  const handleDuplicateKit = async (kit: Kit) => {
    try {
      const newKitName = `${kit.name} (duplikat)`;

      const { data: newKit, error: kitError } = await supabase
        .from('equipment_kits')
        .insert({
          name: newKitName,
          description: kit.description,
          thumbnail_url: kit.thumbnail_url,
          is_active: true,
        })
        .select()
        .single();

      if (kitError) throw kitError;

      const itemsToInsert = kit.equipment_kit_items.map((item, index) => ({
        kit_id: newKit.id,
        equipment_id: item.equipment_id,
        quantity: item.quantity,
        notes: item.notes,
        order_index: index,
      }));

      const { error: itemsError } = await supabase
        .from('equipment_kit_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      fetchKits();
      alert(`Zestaw "${newKitName}" został zduplikowany`);
    } catch (error) {
      console.error('Error duplicating kit:', error);
      alert('Błąd podczas duplikowania zestawu');
    }
  };

  const filteredEquipment = equipment.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.brand?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.model?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-[#d3bb73]/10 flex items-center justify-between">
          <h3 className="text-xl font-light text-[#e5e4e2]">Zarządzanie zestawami sprzętu</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#e5e4e2]/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#e5e4e2]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!showAddForm ? (
            <>
              <div className="flex items-center justify-between mb-6">
                <p className="text-[#e5e4e2]/60">
                  Zestawy pozwalają na grupowanie sprzętu (np. "Kablarka Standard 1")
                </p>
                <button
                  onClick={() => handleOpenForm()}
                  className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Nowy zestaw
                </button>
              </div>

              {loading ? (
                <div className="text-center py-12 text-[#e5e4e2]/60">Ładowanie...</div>
              ) : kits.length === 0 ? (
                <div className="text-center py-12">
                  <Package className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
                  <p className="text-[#e5e4e2]/60">Brak zestawów</p>
                  <p className="text-sm text-[#e5e4e2]/40 mt-2">Kliknij "Nowy zestaw" aby stworzyć pierwszy zestaw</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {kits.map((kit) => (
                    <div
                      key={kit.id}
                      className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-xl p-4"
                    >
                      <div className="flex items-start gap-4 mb-3">
                        {kit.thumbnail_url ? (
                          <img
                            src={kit.thumbnail_url}
                            alt={kit.name}
                            className="w-16 h-16 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="w-16 h-16 bg-[#d3bb73]/20 rounded-lg flex items-center justify-center">
                            <Package className="w-8 h-8 text-[#d3bb73]" />
                          </div>
                        )}
                        <div className="flex-1">
                          <h4 className="text-[#e5e4e2] font-medium mb-1">{kit.name}</h4>
                          {kit.description && (
                            <p className="text-sm text-[#e5e4e2]/60">{kit.description}</p>
                          )}
                          <p className="text-xs text-[#e5e4e2]/40 mt-1">
                            {kit.equipment_kit_items.length} pozycji
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setViewingKit(kit)}
                            className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                            title="Podgląd i drukowanie"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDuplicateKit(kit)}
                            className="p-2 text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors"
                            title="Duplikuj zestaw"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleOpenForm(kit)}
                            className="p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteKit(kit.id)}
                            className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {kit.equipment_kit_items.length > 0 && (
                        <div className="space-y-1 pl-20">
                          {kit.equipment_kit_items.map((item) => (
                            <div key={item.id} className="text-sm text-[#e5e4e2]/60 flex items-center gap-2">
                              <span className="text-[#d3bb73]">•</span>
                              <span>{item.quantity}x</span>
                              <span>{item.equipment_items.name}</span>
                              {item.equipment_items.brand && (
                                <span className="text-[#e5e4e2]/40">({item.equipment_items.brand})</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-6">
              <div>
                <h4 className="text-[#e5e4e2] font-medium mb-4">
                  {editingKit ? 'Edytuj zestaw' : 'Nowy zestaw'}
                </h4>

                <div className="space-y-4">
                  {kitForm.thumbnail_url && (
                    <div className="relative w-32 h-32 mx-auto">
                      <img
                        src={kitForm.thumbnail_url}
                        alt="Miniaturka"
                        className="w-full h-full object-cover rounded-lg border border-[#d3bb73]/20"
                      />
                      <button
                        onClick={() => setKitForm(prev => ({ ...prev, thumbnail_url: '' }))}
                        className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">Miniaturka (opcjonalna)</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleThumbnailUpload}
                      disabled={uploading}
                      className="hidden"
                      id="kit-thumbnail-upload"
                    />
                    <label
                      htmlFor="kit-thumbnail-upload"
                      className={`flex items-center justify-center gap-2 w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] cursor-pointer hover:border-[#d3bb73]/30 transition-colors ${uploading ? 'opacity-50' : ''}`}
                    >
                      <Plus className="w-4 h-4" />
                      {uploading ? 'Przesyłanie...' : kitForm.thumbnail_url ? 'Zmień zdjęcie' : 'Dodaj zdjęcie'}
                    </label>
                  </div>

                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa zestawu *</label>
                    <input
                      type="text"
                      value={kitForm.name}
                      onChange={(e) => setKitForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="np. Kablarka Standard 1"
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
                    <textarea
                      value={kitForm.description}
                      onChange={(e) => setKitForm(prev => ({ ...prev, description: e.target.value }))}
                      rows={2}
                      placeholder="Krótki opis zestawu..."
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-[#d3bb73]/10 pt-6">
                <h5 className="text-[#e5e4e2] font-medium mb-4">Pozycje w zestawie</h5>

                {kitItems.length > 0 && (
                  <div className="space-y-3 mb-4">
                    {kitItems.map((item, index) => {
                      const eq = equipment.find(e => e.id === item.equipment_id);
                      return (
                        <div key={index} className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-3">
                          <div className="flex items-start gap-3">
                            {eq?.thumbnail_url && (
                              <img
                                src={eq.thumbnail_url}
                                alt={eq.name}
                                className="w-12 h-12 rounded object-cover"
                              />
                            )}
                            <div className="flex-1">
                              <div className="text-[#e5e4e2] font-medium">{eq?.name || 'Nieznany sprzęt'}</div>
                              {eq?.brand && (
                                <div className="text-sm text-[#e5e4e2]/60">{eq.brand} {eq.model}</div>
                              )}
                              <div className="grid grid-cols-2 gap-2 mt-2">
                                <div>
                                  <label className="text-xs text-[#e5e4e2]/40">
                                    Ilość <span className="text-[#d3bb73]">(maks. {eq?.equipment_units?.filter(u => u.status === 'available').length || 0})</span>
                                  </label>
                                  <input
                                    type="number"
                                    min="1"
                                    max={eq?.equipment_units?.filter(u => u.status === 'available').length || 0}
                                    value={item.quantity}
                                    onChange={(e) => handleUpdateKitItem(index, 'quantity', e.target.value)}
                                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded px-2 py-1 text-[#e5e4e2] text-sm"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs text-[#e5e4e2]/40">Notatka</label>
                                  <input
                                    type="text"
                                    value={item.notes}
                                    onChange={(e) => handleUpdateKitItem(index, 'notes', e.target.value)}
                                    placeholder="opcjonalne"
                                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded px-2 py-1 text-[#e5e4e2] text-sm placeholder-[#e5e4e2]/30"
                                  />
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => handleRemoveKitItem(index)}
                              className="p-1 text-red-400 hover:bg-red-500/10 rounded transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Search className="w-4 h-4 text-[#e5e4e2]/40" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Szukaj sprzętu do dodania..."
                      className="flex-1 bg-transparent text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none"
                    />
                  </div>

                  <div className="max-h-60 overflow-y-auto space-y-2">
                    {filteredEquipment.map((item) => {
                      const isAdded = kitItems.some(ki => ki.equipment_id === item.id);
                      return (
                        <button
                          key={item.id}
                          onClick={() => !isAdded && handleAddKitItem(item.id)}
                          disabled={isAdded}
                          className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors ${
                            isAdded
                              ? 'opacity-50 cursor-not-allowed'
                              : 'hover:bg-[#1c1f33]'
                          }`}
                        >
                          {item.thumbnail_url ? (
                            <img
                              src={item.thumbnail_url}
                              alt={item.name}
                              className="w-10 h-10 rounded object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 bg-[#d3bb73]/20 rounded flex items-center justify-center">
                              <Package className="w-5 h-5 text-[#d3bb73]" />
                            </div>
                          )}
                          <div className="flex-1 text-left">
                            <div className="text-[#e5e4e2] text-sm">{item.name}</div>
                            {item.brand && (
                              <div className="text-xs text-[#e5e4e2]/60">{item.brand} {item.model}</div>
                            )}
                            <div className="text-xs text-[#d3bb73] mt-1">
                              Dostępne: {item.equipment_units?.filter(u => u.status === 'available').length || 0} szt.
                            </div>
                          </div>
                          {isAdded && <span className="text-xs text-green-400">✓ Dodano</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-[#d3bb73]/10">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="flex-1 px-4 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
                >
                  Anuluj
                </button>
                <button
                  onClick={handleSaveKit}
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Zapisywanie...' : 'Zapisz zestaw'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {viewingKit && (
        <>
          <style>{`
            @media print {
              body * {
                visibility: hidden;
              }
              #kit-checklist-print, #kit-checklist-print * {
                visibility: visible;
              }
              #kit-checklist-print {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                padding: 20mm;
                background: white;
                color: black;
              }
              #kit-checklist-print h1 {
                font-size: 18pt;
                margin-bottom: 10pt;
                font-weight: bold;
              }
              #kit-checklist-print table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 10pt;
              }
              #kit-checklist-print th {
                text-align: left;
                padding: 8pt 4pt;
                border-bottom: 2pt solid black;
                font-weight: bold;
              }
              #kit-checklist-print td {
                padding: 6pt 4pt;
                border-bottom: 1pt solid #ccc;
              }
              #kit-checklist-print .checkbox {
                width: 15pt;
                height: 15pt;
                border: 1.5pt solid black;
                display: inline-block;
                margin-right: 8pt;
              }
              @page {
                margin: 15mm;
              }
            }
          `}</style>

          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4 print:hidden">
            <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              <div className="p-6 border-b border-[#d3bb73]/10 flex items-center justify-between">
                <h3 className="text-xl font-light text-[#e5e4e2]">Podgląd zestawu: {viewingKit.name}</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => window.print()}
                    className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                  >
                    <Printer className="w-4 h-4" />
                    Drukuj checklistę
                  </button>
                  <button
                    onClick={() => setViewingKit(null)}
                    className="p-2 hover:bg-[#e5e4e2]/10 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5 text-[#e5e4e2]" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                <div className="mb-6 flex items-start gap-4">
                  {viewingKit.thumbnail_url && (
                    <img
                      src={viewingKit.thumbnail_url}
                      alt={viewingKit.name}
                      className="w-24 h-24 rounded-lg object-cover"
                    />
                  )}
                  <div>
                    <h2 className="text-2xl font-medium text-[#e5e4e2] mb-2">{viewingKit.name}</h2>
                    {viewingKit.description && (
                      <p className="text-[#e5e4e2]/60 mb-2">{viewingKit.description}</p>
                    )}
                    <p className="text-sm text-[#e5e4e2]/40">
                      {viewingKit.equipment_kit_items.length} pozycji • Utworzono: {new Date(viewingKit.created_at).toLocaleDateString('pl-PL')}
                    </p>
                  </div>
                </div>

                <div className="border border-[#d3bb73]/20 rounded-lg overflow-hidden">
                  <div className="bg-[#d3bb73]/10 px-4 py-3 border-b border-[#d3bb73]/20">
                    <h4 className="text-[#e5e4e2] font-medium">Lista sprzętu</h4>
                  </div>
                  <div className="divide-y divide-[#d3bb73]/10">
                    {viewingKit.equipment_kit_items.map((item, index) => {
                      const availableQty = equipment.find(e => e.id === item.equipment_id)?.equipment_units?.filter(u => u.status === 'available').length || 0;
                      const isAvailable = availableQty >= item.quantity;

                      return (
                        <div
                          key={item.id}
                          className="p-4 hover:bg-[#0f1119] transition-colors flex items-start gap-4 cursor-pointer group"
                          onClick={() => {
                            window.location.href = `/crm/equipment/${item.equipment_id}`;
                          }}
                        >
                          <div className="flex-shrink-0 w-6 h-6 border-2 border-[#d3bb73]/40 rounded" />
                          <div className="flex-1">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[#e5e4e2] font-medium group-hover:text-[#d3bb73]">
                                    {index + 1}. {item.equipment_items.name}
                                  </span>
                                  {!isAvailable && (
                                    <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400">
                                      Niewystarczająca ilość
                                    </span>
                                  )}
                                </div>
                                {item.equipment_items.brand && (
                                  <p className="text-sm text-[#e5e4e2]/60">
                                    {item.equipment_items.brand} {item.equipment_items.model}
                                  </p>
                                )}
                                {item.notes && (
                                  <p className="text-sm text-[#e5e4e2]/40 mt-1">
                                    Notatka: {item.notes}
                                  </p>
                                )}
                              </div>
                              <div className="text-right">
                                <div className="text-lg font-medium text-[#e5e4e2]">
                                  {item.quantity} szt.
                                </div>
                                <div className={`text-xs ${isAvailable ? 'text-green-400' : 'text-red-400'}`}>
                                  Dostępne: {availableQty}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Ukryty element do druku */}
          <div id="kit-checklist-print" className="hidden print:block">
            <h1>{viewingKit.name}</h1>
            {viewingKit.description && <p style={{marginBottom: '10pt'}}>{viewingKit.description}</p>}

            <table>
              <thead>
                <tr>
                  <th style={{width: '40px'}}>✓</th>
                  <th style={{width: '40px'}}>Lp.</th>
                  <th>Nazwa sprzętu</th>
                  <th>Model</th>
                  <th style={{width: '60px', textAlign: 'center'}}>Ilość</th>
                  <th style={{width: '70px', textAlign: 'center'}}>Wydano</th>
                  <th style={{width: '70px', textAlign: 'center'}}>Zdano</th>
                  <th style={{width: '120px'}}>Stan na odbiór</th>
                  <th>Notatki</th>
                </tr>
              </thead>
              <tbody>
                {viewingKit.equipment_kit_items.map((item, index) => (
                  <tr key={item.id}>
                    <td><span className="checkbox"></span></td>
                    <td>{index + 1}</td>
                    <td>{item.equipment_items.name}</td>
                    <td>{item.equipment_items.brand ? `${item.equipment_items.brand} ${item.equipment_items.model || ''}` : '-'}</td>
                    <td style={{textAlign: 'center'}}>{item.quantity}</td>
                    <td style={{textAlign: 'center'}}>_____</td>
                    <td style={{textAlign: 'center'}}>_____</td>
                    <td>_________________</td>
                    <td>{item.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{marginTop: '30pt', borderTop: '1pt solid #ccc', paddingTop: '15pt'}}>
              <p>Data: {new Date().toLocaleDateString('pl-PL')}</p>
              <p style={{marginTop: '20pt'}}>Osoba wydająca: _____________________________</p>
              <p style={{marginTop: '20pt'}}>Osoba odbierająca: _____________________________</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
