import { useState } from 'react';
import { Dialog } from '@mui/material';
import { X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface Props {
  row: any;
  compatible: boolean;
  equipmentId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

const field = 'mt-1 w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-[#e5e4e2] outline-none focus:border-[#d3bb73]/30';

export function ComponentEditDialog({ row, compatible, equipmentId, onClose, onSaved }: Props) {
  const { showSnackbar } = useSnackbar();
  const [name, setName] = useState<string>(row.component_name || '');
  const [quantity, setQuantity] = useState<string>(String(row.quantity ?? 1));
  const [description, setDescription] = useState<string>((compatible ? row.notes : row.description) || '');
  const [optional, setOptional] = useState<boolean>(!!row.is_optional);
  const [type, setType] = useState<string>(row.compatibility_type || 'optional');
  const [group, setGroup] = useState<string>(row.compatibility_group || '');
  const [mode, setMode] = useState<string>(row.quantity_mode || 'per_item');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const product = row.compatible_equipment || row.compatible_kit || row.compatible_cable;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const amount = Number(quantity);
    if (!Number.isFinite(amount) || amount < 1 || !Number.isInteger(amount)) {
      setError('Wpisz poprawną ilość — liczbę całkowitą większą od zera.');
      return;
    }
    if (!compatible && !name.trim()) {
      setError('Podaj nazwę komponentu.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = compatible ? {
        quantity: amount,
        compatibility_type: type,
        compatibility_group: group.trim() || null,
        quantity_mode: mode,
        notes: description.trim() || null,
      } : {
        component_name: name.trim(),
        quantity: amount,
        description: description.trim() || null,
        is_optional: optional,
        is_included: !optional,
      };
      const { error: updateError } = await supabase
        .from(compatible ? 'equipment_compatible_items' : 'equipment_components')
        .update(payload)
        .eq('id', row.id)
        .eq('equipment_id', equipmentId)
        .select('id')
        .single();
      if (updateError) throw updateError;
      await onSaved();
      showSnackbar('Zmiany elementu zostały zapisane', 'success');
    } catch (saveError) {
      console.error('Error updating equipment component:', saveError);
      setError('Nie udało się zapisać zmian. Spróbuj ponownie.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={() => { if (!saving) onClose(); }} maxWidth="sm" fullWidth
      PaperProps={{ sx: { backgroundColor: 'var(--bg-secondary, #1c1f33)', color: '#e5e4e2', borderRadius: '16px', border: '1px solid rgba(211,187,115,0.1)' } }}>
      <form onSubmit={save} className="p-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 className="text-xl font-semibold uppercase">Edytuj element zestawu</h3>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Zamknij" className="rounded-lg p-2 hover:bg-white/5 disabled:opacity-40"><X className="h-5 w-5" /></button>
        </div>
        {compatible && <p className="mb-4 text-[#d3bb73]">{product?.name}</p>}
        <fieldset disabled={saving} className="space-y-4 disabled:opacity-60">
          {!compatible && <label className="block text-sm">Nazwa<input autoFocus required value={name} onChange={e => setName(e.target.value)} className={field} /></label>}
          <label className="block text-sm">Ilość<input autoFocus={compatible} type="number" min="1" step="1" required value={quantity} onChange={e => setQuantity(e.target.value)} className={field} /></label>
          {compatible ? <>
            <label className="block text-sm">Typ powiązania<select value={type} onChange={e => setType(e.target.value)} className={field}>
              <option value="required">Wymagany</option><option value="recommended">Rekomendowany</option><option value="optional">Opcjonalny</option>
            </select></label>
            <label className="block text-sm">Sposób przeliczania<select value={mode} onChange={e => setMode(e.target.value)} className={field}>
              <option value="per_item">Na każdą sztukę sprzętu</option><option value="fixed">Stała liczba dla całego wydarzenia</option>
            </select></label>
            <label className="block text-sm">Grupa alternatyw<input value={group} onChange={e => setGroup(e.target.value)} placeholder="Bez grupy" className={field} /><span className="mt-1 block text-xs text-[#e5e4e2]/60">Ta sama nazwa grupy łączy elementy, spośród których wybierasz jeden.</span></label>
          </> : <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={optional} onChange={e => setOptional(e.target.checked)} className="h-4 w-4 accent-[#d3bb73]" />Opcjonalny</label>}
          <label className="block text-sm">{compatible ? 'Notatki' : 'Opis'}<textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className={field} /></label>
        </fieldset>
        {error && <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-lg px-4 py-2 text-[#e5e4e2]/70 disabled:opacity-40">Anuluj</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#0f1119] disabled:opacity-40">{saving ? 'Zapisywanie…' : 'Zapisz zmiany'}</button>
        </div>
      </form>
    </Dialog>
  );
}
