'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Trash2, Package, Search, Edit, ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { uploadImage } from '@/lib/storage';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

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

interface Cable {
  id: string;
  name: string;
  length_meters: number | null;
  thumbnail_url: string | null;
  stock_quantity: number;
}

interface KitItem {
  id: string;
  equipment_id: string | null;
  cable_id: string | null;
  quantity: number;
  notes: string | null;
  order_index: number;
  equipment_items?: Equipment;
  cables?: Cable;
}

interface Kit {
  id: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  warehouse_category_id: string | null;
  is_active: boolean;
  created_at: string;
  equipment_kit_items: KitItem[];
}

interface WarehouseCategory {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  parent_id: string | null;
  level: number;
}

export default function KitsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canManageModule } = useCurrentEmployee();
  const canManage = canManageModule('equipment');

  const [kits, setKits] = useState<Kit[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [cables, setCables] = useState<Cable[]>([]);
  const [categories, setCategories] = useState<WarehouseCategory[]>([]);
  const [itemType, setItemType] = useState<'equipment' | 'cable'>('equipment');
  const [loading, setLoading] = useState(true);
  const [viewingKit, setViewingKit] = useState<Kit | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingKit, setEditingKit] = useState<Kit | null>(null);
  const [kitForm, setKitForm] = useState({
    name: '',
    description: '',
    thumbnail_url: '',
    warehouse_category_id: '',
  });
  const [kitItems, setKitItems] = useState<
    { equipment_id: string | null; cable_id: string | null; quantity: number; notes: string }[]
  >([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [equipmentSearchTerm, setEquipmentSearchTerm] = useState('');
  const [cableSearchTerm, setCableSearchTerm] = useState('');

  useEffect(() => {
    fetchCategories();
    fetchEquipment();
    fetchCables();
    fetchKits();
  }, []);

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (editId && kits.length > 0) {
      const kitToView = kits.find((k) => k.id === editId);
      if (kitToView) {
        setViewingKit(kitToView);
        setIsEditMode(false);
      }
    }
  }, [searchParams, kits]);

  const fetchCategories = async () => {
    const { data } = await supabase
      .from('warehouse_categories')
      .select('id, name, color, icon, parent_id, level')
      .eq('is_active', true)
      .order('name');
    if (data) setCategories(data);
  };

  const fetchEquipment = async () => {
    const { data } = await supabase
      .from('equipment_items')
      .select(
        `
        id,
        name,
        brand,
        model,
        thumbnail_url,
        equipment_units(id, status)
      `,
      )
      .eq('is_active', true)
      .order('name');
    if (data) setEquipment(data);
  };

  const fetchCables = async () => {
    const { data } = await supabase
      .from('cables')
      .select('id, name, length_meters, thumbnail_url, stock_quantity')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name');
    if (data) setCables(data);
  };

  const fetchKits = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('equipment_kits')
        .select(
          `
          *,
          equipment_kit_items(
            *,
            equipment_items(id, name, brand, model, thumbnail_url),
            cables(id, name, length_meters, thumbnail_url, stock_quantity)
          )
        `,
        )
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setKits(data || []);
    } catch (error) {
      console.error('Error fetching kits:', error);
      showSnackbar('Błąd podczas pobierania zestawów', 'error');
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
        warehouse_category_id: kit.warehouse_category_id || '',
      });
      setKitItems(
        kit.equipment_kit_items.map((item) => ({
          equipment_id: item.equipment_id,
          cable_id: item.cable_id,
          quantity: item.quantity,
          notes: item.notes || '',
        })),
      );
    } else {
      setEditingKit(null);
      setKitForm({
        name: '',
        description: '',
        thumbnail_url: '',
        warehouse_category_id: '',
      });
      setKitItems([]);
    }
    setIsEditMode(true);
  };

  const handleViewKit = (kit: Kit) => {
    setViewingKit(kit);
    setIsEditMode(false);
  };

  const handleEditKit = (kit: Kit) => {
    setViewingKit(null);
    handleOpenForm(kit);
  };

  const handlePrintChecklist = async () => {
    if (!viewingKit) return;

    // Pobierz dane zalogowanego pracownika
    const {
      data: { user },
    } = await supabase.auth.getUser();
    let printerName = 'Nieznany użytkownik';

    if (user) {
      const { data: employeeData } = await supabase
        .from('employees')
        .select('name, surname')
        .eq('id', user.id)
        .maybeSingle();

      if (employeeData) {
        printerName = `${employeeData.name} ${employeeData.surname}`;
      }
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const items = viewingKit.equipment_kit_items
      .map((item, index) => {
        const eq = item.equipment_items;
        const brandModel = eq?.brand ? `${eq.brand}${eq.model ? ' ' + eq.model : ''}` : '';
        const notes = item.notes ? ` • ${item.notes}` : '';

        return `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; text-align: center;">
            <input type="checkbox" style="width: 16px; height: 16px; margin: 0;">
          </td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; text-align: center; color: #999;">${index + 1}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e5e5;">
            <strong>${eq?.name || 'Nieznany sprzęt'}</strong>${brandModel ? ` <span style="color: #666;">${brandModel}</span>` : ''}${notes ? `<span style="color: #888; font-style: italic;">${notes}</span>` : ''}
          </td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e5e5; text-align: center; font-weight: 600;">
            ${item.quantity}
          </td>
        </tr>
      `;
      })
      .join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Checklista - ${viewingKit.name}</title>
          <style>
            @media print {
              @page { margin: 1.5cm; }
            }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              padding: 15px;
              line-height: 1.3;
              font-size: 13px;
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 15px;
              padding-bottom: 10px;
              border-bottom: 2px solid #333;
            }
            h1 {
              font-size: 20px;
              font-weight: 600;
              color: #1a1a1a;
            }
            .info {
              text-align: right;
              font-size: 11px;
              color: #666;
            }
            table {
              width: 100%;
              border-collapse: collapse;
            }
            th {
              background-color: #f5f5f5;
              padding: 6px 8px;
              text-align: left;
              font-weight: 600;
              font-size: 12px;
              color: #333;
              border-bottom: 2px solid #ddd;
            }
            td {
              font-size: 13px;
              color: #333;
            }
            .checkbox-col { width: 40px; text-align: center; }
            .number-col { width: 40px; text-align: center; }
            .qty-col { width: 60px; text-align: center; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${viewingKit.name}</h1>
            <div class="info">
              <div>${new Date().toLocaleDateString('pl-PL', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
              <div>Drukował: <strong>${printerName}</strong></div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th class="checkbox-col"></th>
                <th class="number-col">Lp.</th>
                <th>Nazwa sprzętu</th>
                <th class="qty-col">Ilość</th>
              </tr>
            </thead>
            <tbody>
              ${items}
            </tbody>
          </table>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const url = await uploadImage(file, 'equipment-kits');
      setKitForm((prev) => ({ ...prev, thumbnail_url: url }));
      showSnackbar('Zdjęcie zostało przesłane', 'success');
    } catch (error) {
      showSnackbar('Błąd podczas przesyłania zdjęcia', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) {
      showSnackbar('Proszę upuścić plik obrazu', 'warning');
      return;
    }

    setUploading(true);
    try {
      const url = await uploadImage(file, 'equipment-kits');
      setKitForm((prev) => ({ ...prev, thumbnail_url: url }));
      showSnackbar('Zdjęcie zostało przesłane', 'success');
    } catch (error) {
      showSnackbar('Błąd podczas przesyłania zdjęcia', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleAddKitItem = (itemId: string, type: 'equipment' | 'cable') => {
    if (type === 'equipment') {
      if (kitItems.some((item) => item.equipment_id === itemId)) {
        showSnackbar('Ten sprzęt jest już w zestawie', 'warning');
        return;
      }
      setKitItems((prev) => [
        ...prev,
        { equipment_id: itemId, cable_id: null, quantity: 1, notes: '' },
      ]);
    } else {
      if (kitItems.some((item) => item.cable_id === itemId)) {
        showSnackbar('Ten przewód jest już w zestawie', 'warning');
        return;
      }
      setKitItems((prev) => [
        ...prev,
        { equipment_id: null, cable_id: itemId, quantity: 1, notes: '' },
      ]);
    }
  };

  const handleRemoveKitItem = (index: number) => {
    setKitItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateKitItem = (index: number, field: 'quantity' | 'notes', value: string) => {
    setKitItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? { ...item, [field]: field === 'quantity' ? parseInt(value) || 1 : value }
          : item,
      ),
    );
  };

  const handleSaveKit = async () => {
    if (!kitForm.name.trim()) {
      showSnackbar('Nazwa zestawu jest wymagana', 'warning');
      return;
    }

    if (kitItems.length === 0) {
      showSnackbar('Dodaj przynajmniej jedną pozycję do zestawu', 'warning');
      return;
    }

    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      let kitId = editingKit?.id;

      if (editingKit) {
        const { error: updateError } = await supabase
          .from('equipment_kits')
          .update({
            name: kitForm.name,
            description: kitForm.description || null,
            thumbnail_url: kitForm.thumbnail_url || null,
            warehouse_category_id: kitForm.warehouse_category_id || null,
          })
          .eq('id', editingKit.id);

        if (updateError) throw updateError;

        const { error: deleteError } = await supabase
          .from('equipment_kit_items')
          .delete()
          .eq('kit_id', editingKit.id);

        if (deleteError) throw deleteError;
      } else {
        const { data: newKit, error: insertError } = await supabase
          .from('equipment_kits')
          .insert({
            name: kitForm.name,
            description: kitForm.description || null,
            thumbnail_url: kitForm.thumbnail_url || null,
            warehouse_category_id: kitForm.warehouse_category_id || null,
            created_by: user?.id || null,
          })
          .select()
          .single();

        if (insertError) throw insertError;
        kitId = newKit.id;
      }

      const itemsToInsert = kitItems.map((item, index) => ({
        kit_id: kitId,
        equipment_id: item.equipment_id || null,
        cable_id: item.cable_id || null,
        quantity: item.quantity,
        notes: item.notes || null,
        order_index: index,
      }));

      const { error: itemsError } = await supabase
        .from('equipment_kit_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      showSnackbar(editingKit ? 'Zestaw zaktualizowany' : 'Zestaw utworzony', 'success');
      setIsEditMode(false);
      await fetchKits();

      const updatedKit = kits.find((k) => k.id === kitId);
      if (updatedKit) {
        setViewingKit(updatedKit);
      }
    } catch (error) {
      console.error('Error saving kit:', error);
      showSnackbar('Błąd podczas zapisywania zestawu', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteKit = async (kitId: string) => {
    const confirmed = await showConfirm('Czy na pewno chcesz usunąć ten zestaw?', 'Usuń');
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('equipment_kits')
        .update({ is_active: false })
        .eq('id', kitId);

      if (error) throw error;
      showSnackbar('Zestaw usunięty', 'success');
      fetchKits();
    } catch (error) {
      console.error('Error deleting kit:', error);
      showSnackbar('Błąd podczas usuwania zestawu', 'error');
    }
  };

  const mainCategories = categories.filter((c) => c.level === 0 || c.parent_id === null);

  const filtered = kits.filter((kit) => kit.name.toLowerCase().includes(searchTerm.toLowerCase()));

  const filteredEquipment = equipment.filter((eq) => {
    const searchLower = equipmentSearchTerm.toLowerCase();
    return (
      eq.name.toLowerCase().includes(searchLower) ||
      eq.brand?.toLowerCase().includes(searchLower) ||
      eq.model?.toLowerCase().includes(searchLower)
    );
  });

  const filteredCables = cables.filter((cable) => {
    const searchLower = cableSearchTerm.toLowerCase();
    return cable.name.toLowerCase().includes(searchLower);
  });

  if (viewingKit && !isEditMode) {
    const category = categories.find((c) => c.id === viewingKit.warehouse_category_id);
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                setViewingKit(null);
                router.push('/crm/equipment/kits');
              }}
              className="rounded-lg p-2 transition-colors hover:bg-[#1c1f33]"
            >
              <ArrowLeft className="h-5 w-5 text-[#e5e4e2]" />
            </button>
            <h2 className="text-2xl font-light text-[#e5e4e2]">{viewingKit.name}</h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handlePrintChecklist}
              className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] hover:border-[#d3bb73]/40"
            >
              Wydrukuj checklistę
            </button>
            {canManage && (
              <button
                onClick={() => handleEditKit(viewingKit)}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
              >
                <Edit className="h-4 w-4" />
                Edytuj
              </button>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-6">
          <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-3">
            {viewingKit.thumbnail_url && (
              <div className="md:col-span-1">
                <img
                  src={viewingKit.thumbnail_url}
                  alt={viewingKit.name}
                  className="h-48 w-full rounded-lg object-cover"
                />
              </div>
            )}
            <div className={viewingKit.thumbnail_url ? 'md:col-span-2' : 'md:col-span-3'}>
              <h3 className="mb-2 text-xl font-medium text-[#e5e4e2]">{viewingKit.name}</h3>
              {category && <div className="mb-3 text-sm text-[#d3bb73]">{category.name}</div>}
              {viewingKit.description && (
                <p className="mb-4 text-[#e5e4e2]/60">{viewingKit.description}</p>
              )}
              <div className="text-sm text-[#e5e4e2]/40">
                Utworzono: {new Date(viewingKit.created_at).toLocaleDateString('pl-PL')}
              </div>
            </div>
          </div>

          <div className="border-t border-[#d3bb73]/10 pt-6">
            <h4 className="mb-4 text-lg font-medium text-[#e5e4e2]">
              Pozycje w zestawie ({viewingKit.equipment_kit_items.length})
            </h4>
            <div className="space-y-3">
              {viewingKit.equipment_kit_items.map((item, index) => {
                const eq = item.equipment_id
                  ? equipment.find((e) => e.id === item.equipment_id)
                  : null;
                const cable = item.cable_id ? cables.find((c) => c.id === item.cable_id) : null;
                const displayItem = eq || cable;
                const unit = eq ? 'x' : 'm';
                const availableQty = eq
                  ? eq.equipment_units?.filter((u) => u.status === 'available').length || 0
                  : cable?.stock_quantity || 0;

                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-4 rounded-lg bg-[#1c1f33] p-4"
                  >
                    <div className="w-8 text-center font-mono text-[#e5e4e2]/40">{index + 1}.</div>
                    {displayItem?.thumbnail_url && (
                      <img
                        src={displayItem.thumbnail_url}
                        alt={displayItem.name}
                        className="h-16 w-16 rounded object-cover"
                      />
                    )}
                    <div className="flex-1">
                      <div className="font-medium text-[#e5e4e2]">
                        {displayItem?.name || 'Nieznany element'}
                        {cable && <span className="ml-2 text-xs text-[#d3bb73]">Przewód</span>}
                      </div>
                      {eq?.brand && (
                        <div className="text-sm text-[#e5e4e2]/60">
                          {eq.brand} {eq.model}
                        </div>
                      )}
                      {cable?.length_meters && (
                        <div className="text-sm text-[#e5e4e2]/60">{cable.length_meters}m</div>
                      )}
                      {item.notes && (
                        <div className="mt-1 text-xs italic text-[#e5e4e2]/40">{item.notes}</div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-[#d3bb73]">
                        {unit}
                        {item.quantity}
                      </div>
                      <div className="text-xs text-[#e5e4e2]/40">{availableQty} dostępnych</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isEditMode) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                setIsEditMode(false);
                if (editingKit) {
                  setViewingKit(editingKit);
                } else {
                  router.push('/crm/equipment/kits');
                }
              }}
              className="rounded-lg p-2 transition-colors hover:bg-[#1c1f33]"
            >
              <ArrowLeft className="h-5 w-5 text-[#e5e4e2]" />
            </button>
            <h2 className="text-2xl font-light text-[#e5e4e2]">
              {editingKit ? 'Edytuj zestaw' : 'Nowy zestaw'}
            </h2>
          </div>
          <button
            onClick={handleSaveKit}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {saving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>

        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-6">
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Miniaturka</label>
                {kitForm.thumbnail_url ? (
                  <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-[#1c1f33]">
                    <img
                      src={kitForm.thumbnail_url}
                      alt="Miniaturka"
                      className="h-full w-full object-cover"
                    />
                    <button
                      onClick={() => setKitForm((prev) => ({ ...prev, thumbnail_url: '' }))}
                      className="absolute right-2 top-2 rounded bg-red-500 p-1 text-white hover:bg-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <label
                    className="flex aspect-square w-full cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-[#d3bb73]/20 bg-[#1c1f33] transition-colors hover:border-[#d3bb73]/40"
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                  >
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleThumbnailUpload}
                      className="hidden"
                      disabled={uploading}
                    />
                    <div className="text-center">
                      <Package className="mx-auto mb-2 h-12 w-12 text-[#e5e4e2]/40" />
                      <span className="block text-sm text-[#e5e4e2]/40">
                        {uploading ? 'Przesyłanie...' : 'Kliknij lub przeciągnij zdjęcie'}
                      </span>
                      <span className="mt-1 block text-xs text-[#e5e4e2]/20">
                        Obsługiwane formaty: JPG, PNG, WEBP
                      </span>
                    </div>
                  </label>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa zestawu *</label>
                  <input
                    type="text"
                    value={kitForm.name}
                    onChange={(e) => setKitForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="np. Kablarka Standard 1"
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/30 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
                  <textarea
                    value={kitForm.description}
                    onChange={(e) =>
                      setKitForm((prev) => ({ ...prev, description: e.target.value }))
                    }
                    rows={2}
                    placeholder="Krótki opis zestawu..."
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/30 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kategoria główna</label>
                  <select
                    value={kitForm.warehouse_category_id}
                    onChange={(e) =>
                      setKitForm((prev) => ({ ...prev, warehouse_category_id: e.target.value }))
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  >
                    <option value="">Brak kategorii</option>
                    {mainCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="border-t border-[#d3bb73]/10 pt-6">
              <h5 className="mb-4 font-medium text-[#e5e4e2]">Pozycje w zestawie</h5>

              {kitItems.length > 0 && (
                <div className="mb-4 space-y-3">
                  {kitItems.map((item, index) => {
                    const eq = item.equipment_id
                      ? equipment.find((e) => e.id === item.equipment_id)
                      : null;
                    const cable = item.cable_id ? cables.find((c) => c.id === item.cable_id) : null;
                    const displayItem = eq || cable;
                    const maxQty = eq
                      ? eq.equipment_units?.filter((u) => u.status === 'available').length || 0
                      : cable?.stock_quantity || 0;
                    const unit = eq ? 'szt.' : 'm';

                    return (
                      <div
                        key={index}
                        className="flex items-start gap-3 rounded-lg bg-[#1c1f33] p-3"
                      >
                        {displayItem?.thumbnail_url && (
                          <img
                            src={displayItem.thumbnail_url}
                            alt={displayItem.name}
                            className="h-12 w-12 rounded object-cover"
                          />
                        )}
                        <div className="flex-1">
                          <div className="font-medium text-[#e5e4e2]">
                            {displayItem?.name || 'Nieznany element'}
                            {cable && <span className="ml-2 text-xs text-[#d3bb73]">Przewód</span>}
                          </div>
                          {eq?.brand && (
                            <div className="text-sm text-[#e5e4e2]/60">
                              {eq.brand} {eq.model}
                            </div>
                          )}
                          {cable?.length_meters && (
                            <div className="text-sm text-[#e5e4e2]/60">{cable.length_meters}m</div>
                          )}
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-xs text-[#e5e4e2]/40">
                                Ilość{' '}
                                <span className="text-[#d3bb73]">
                                  (maks. {maxQty} {unit})
                                </span>
                              </label>
                              <input
                                type="number"
                                min="1"
                                max={maxQty}
                                value={item.quantity}
                                onChange={(e) =>
                                  handleUpdateKitItem(index, 'quantity', e.target.value)
                                }
                                className="w-full rounded border border-[#d3bb73]/10 bg-[#0f1119] px-2 py-1 text-sm text-[#e5e4e2]"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-[#e5e4e2]/40">Notatka</label>
                              <input
                                type="text"
                                value={item.notes}
                                onChange={(e) =>
                                  handleUpdateKitItem(index, 'notes', e.target.value)
                                }
                                placeholder="opcjonalne"
                                className="w-full rounded border border-[#d3bb73]/10 bg-[#0f1119] px-2 py-1 text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/30"
                              />
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveKitItem(index)}
                          className="rounded p-1 text-red-400 transition-colors hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div>
                <div className="mb-4 flex items-center gap-2">
                  <button
                    onClick={() => {
                      setItemType('equipment');
                      setEquipmentSearchTerm('');
                    }}
                    className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                      itemType === 'equipment'
                        ? 'bg-[#d3bb73] text-[#1c1f33]'
                        : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
                    }`}
                  >
                    Sprzęt
                  </button>
                  <button
                    onClick={() => {
                      setItemType('cable');
                      setCableSearchTerm('');
                    }}
                    className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                      itemType === 'cable'
                        ? 'bg-[#d3bb73] text-[#1c1f33]'
                        : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
                    }`}
                  >
                    Przewody
                  </button>
                </div>

                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Dodaj {itemType === 'equipment' ? 'sprzęt' : 'przewody'} do zestawu
                </label>

                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" />
                  <input
                    type="text"
                    placeholder={`Szukaj ${itemType === 'equipment' ? 'sprzętu' : 'przewodów'}...`}
                    value={itemType === 'equipment' ? equipmentSearchTerm : cableSearchTerm}
                    onChange={(e) =>
                      itemType === 'equipment'
                        ? setEquipmentSearchTerm(e.target.value)
                        : setCableSearchTerm(e.target.value)
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] py-2 pl-9 pr-4 text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/30 focus:outline-none"
                  />
                </div>

                <div className="max-h-96 overflow-y-auto rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]">
                  {itemType === 'equipment' ? (
                    filteredEquipment.length === 0 ? (
                      <div className="p-4 text-center text-[#e5e4e2]/40">
                        {equipmentSearchTerm ? 'Nie znaleziono sprzętu' : 'Brak dostępnego sprzętu'}
                      </div>
                    ) : (
                      filteredEquipment.map((eq) => {
                        const isInKit = kitItems.some((item) => item.equipment_id === eq.id);
                        const availableUnits =
                          eq.equipment_units?.filter((u) => u.status === 'available').length || 0;
                        return (
                          <label
                            key={eq.id}
                            className={`flex cursor-pointer items-center gap-3 border-b border-[#d3bb73]/5 p-3 transition-colors last:border-0 hover:bg-[#0f1119] ${isInKit ? 'bg-[#d3bb73]/5' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={isInKit}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  handleAddKitItem(eq.id, 'equipment');
                                } else {
                                  const index = kitItems.findIndex(
                                    (item) => item.equipment_id === eq.id,
                                  );
                                  if (index !== -1) handleRemoveKitItem(index);
                                }
                              }}
                              className="h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-0"
                            />
                            {eq.thumbnail_url ? (
                              <img
                                src={eq.thumbnail_url}
                                alt={eq.name}
                                className="h-12 w-12 rounded object-cover"
                              />
                            ) : (
                              <div className="flex h-12 w-12 items-center justify-center rounded bg-[#0f1119]">
                                <Package className="h-6 w-6 text-[#e5e4e2]/40" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium text-[#e5e4e2]">{eq.name}</div>
                              <div className="text-xs text-[#e5e4e2]/60">
                                {eq.brand && (
                                  <span>
                                    {eq.brand} {eq.model}
                                  </span>
                                )}
                                {eq.brand && availableUnits > 0 && <span className="mx-1">•</span>}
                                {availableUnits > 0 && (
                                  <span className="text-[#d3bb73]">
                                    {availableUnits} dostępnych
                                  </span>
                                )}
                              </div>
                            </div>
                          </label>
                        );
                      })
                    )
                  ) : filteredCables.length === 0 ? (
                    <div className="p-4 text-center text-[#e5e4e2]/40">
                      {cableSearchTerm ? 'Nie znaleziono przewodów' : 'Brak dostępnych przewodów'}
                    </div>
                  ) : (
                    filteredCables.map((cable) => {
                      const isInKit = kitItems.some((item) => item.cable_id === cable.id);
                      return (
                        <label
                          key={cable.id}
                          className={`flex cursor-pointer items-center gap-3 border-b border-[#d3bb73]/5 p-3 transition-colors last:border-0 hover:bg-[#0f1119] ${isInKit ? 'bg-[#d3bb73]/5' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={isInKit}
                            onChange={(e) => {
                              if (e.target.checked) {
                                handleAddKitItem(cable.id, 'cable');
                              } else {
                                const index = kitItems.findIndex(
                                  (item) => item.cable_id === cable.id,
                                );
                                if (index !== -1) handleRemoveKitItem(index);
                              }
                            }}
                            className="h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-0"
                          />
                          {cable.thumbnail_url ? (
                            <img
                              src={cable.thumbnail_url}
                              alt={cable.name}
                              className="h-12 w-12 rounded object-cover"
                            />
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center rounded bg-[#0f1119]">
                              <Package className="h-6 w-6 text-[#e5e4e2]/40" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-[#e5e4e2]">{cable.name}</div>
                            <div className="text-xs text-[#e5e4e2]/60">
                              {cable.length_meters && <span>{cable.length_meters}m</span>}
                              {cable.length_meters && cable.stock_quantity > 0 && (
                                <span className="mx-1">•</span>
                              )}
                              {cable.stock_quantity > 0 && (
                                <span className="text-[#d3bb73]">
                                  {cable.stock_quantity} m dostępnych
                                </span>
                              )}
                            </div>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/crm/equipment')}
            className="rounded-lg p-2 transition-colors hover:bg-[#1c1f33]"
          >
            <ArrowLeft className="h-5 w-5 text-[#e5e4e2]" />
          </button>
          <h2 className="text-2xl font-light text-[#e5e4e2]">Zestawy sprzętowe</h2>
        </div>
        {canManage && (
          <button
            onClick={() => handleOpenForm()}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Dodaj zestaw
          </button>
        )}
      </div>

      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
          <input
            type="text"
            placeholder="Szukaj zestawów..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] py-2.5 pl-10 pr-4 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-8">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-[#e5e4e2]/60">
          {searchTerm ? 'Nie znaleziono zestawów' : 'Brak zestawów'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((kit) => {
            const category = categories.find((c) => c.id === kit.warehouse_category_id);
            return (
              <div
                key={kit.id}
                className="overflow-hidden rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] transition-colors hover:border-[#d3bb73]/30"
              >
                {kit.thumbnail_url ? (
                  <div className="h-48 bg-[#0f1119]">
                    <img
                      src={kit.thumbnail_url}
                      alt={kit.name}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-48 items-center justify-center bg-[#0f1119]">
                    <Package className="h-16 w-16 text-[#e5e4e2]/20" />
                  </div>
                )}
                <div className="p-4">
                  <div className="mb-2 flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-medium text-[#e5e4e2]">{kit.name}</h3>
                      {category && (
                        <div className="mt-1 text-xs text-[#d3bb73]">{category.name}</div>
                      )}
                    </div>
                  </div>
                  {kit.description && (
                    <p className="mb-3 text-sm text-[#e5e4e2]/60">{kit.description}</p>
                  )}
                  <div className="mb-3 text-sm text-[#e5e4e2]/40">
                    {kit.equipment_kit_items.length} pozycji
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleOpenForm(kit)}
                        className="flex flex-1 items-center justify-center gap-2 rounded border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] hover:border-[#d3bb73]/30"
                      >
                        <Edit className="h-4 w-4" />
                        Edytuj
                      </button>
                      <button
                        onClick={() => handleDeleteKit(kit.id)}
                        className="flex items-center justify-center gap-2 rounded border border-red-500/20 bg-[#0f1119] px-3 py-2 text-red-400 hover:border-red-500/40"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
