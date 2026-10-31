import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { checklistNoteRecords, type ChecklistNote } from '@/lib/CRM/equipmentChecklistNotes';

export function EquipmentChecklistNotes({ eventId, onDirtyChange, onSaved }: {
  eventId: string; onDirtyChange: (dirty: boolean) => void; onSaved: () => void;
}) {
  const [notes, setNotes] = useState<ChecklistNote[]>([]);
  const [saved, setSaved] = useState<ChecklistNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(notes) !== JSON.stringify(saved);
  const length = notes.reduce((sum, note) => sum + note.text.length, 0);
  useEffect(() => {
    let active = true;
    setLoading(true); setLoaded(false); setEditing(false); setError(''); setNotes([]); setSaved([]);
    supabase.from('events').select('equipment_checklist_notes,equipment_checklist_note_items').eq('id', eventId).single()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError('Nie udało się pobrać notatek do checklisty.');
        else {
          const records = checklistNoteRecords(data?.equipment_checklist_note_items, data?.equipment_checklist_notes);
          setNotes(records); setSaved(records); setLoaded(true);
        }
        setLoading(false);
      });
    return () => { active = false; };
  }, [eventId]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const save = async () => {
    if (saving || !loaded) return;
    if (length > 1000 || notes.length > 50) { setError('Notatki mogą mieć łącznie do 1000 znaków i 50 punktów.'); return; }
    if (notes.some(n => !n.text.trim())) { setError('Uzupełnij treść każdego punktu lub usuń pustą notatkę.'); return; }
    setSaving(true); setError('');
    const value = notes.map(n => ({ ...n, text: n.text.trim() }));
    try {
      const { error } = await supabase.from('events').update({
        equipment_checklist_note_items: value,
        equipment_checklist_notes: value.map(n => n.text).join('\n') || null,
        equipment_checklist_modified: true,
      }).eq('id', eventId).select('id').single();
      if (error) throw error;
      setNotes(value); setSaved(value); setEditing(false); onDirtyChange(false); onSaved();
    } catch { setError('Nie udało się zapisać notatek. Spróbuj ponownie.'); }
    finally { setSaving(false); }
  };
  return <section className="mb-6 rounded-lg bg-black/10 p-4">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-medium text-[#e5e4e2]">Notatki do checklisty</h3>
      {!editing && loaded && <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"><Pencil className="h-3.5 w-3.5" />Edytuj notatki</button>}
    </div>
    {loading ? <p className="mt-3 text-sm text-[#e5e4e2]/50">Wczytywanie notatek…</p> : loaded && <>
      <div className="mt-3 space-y-2">{notes.map((note, index) => <div key={note.id} className="flex items-start gap-3 rounded-lg bg-black/10 p-3">
        <label className="relative mt-0.5 block h-5 w-5 shrink-0">
          <input type="checkbox" checked={note.checked} disabled={saving} aria-label={`Potwierdź notatkę ${index + 1}: ${note.text}`} onChange={e => setNotes(current => current.map(n => n.id === note.id ? { ...n, checked: e.target.checked } : n))} className="peer h-5 w-5 appearance-none rounded-sm border border-white/20 bg-black/15 checked:bg-[#d3bb73] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d3bb73]" />
          {note.checked && <span aria-hidden="true" className="pointer-events-none absolute inset-0 text-center text-lg font-black leading-5 text-[#250914]">X</span>}
        </label>
        {editing ? <textarea aria-label={`Treść notatki ${index + 1}`} rows={2} maxLength={1000} value={note.text} disabled={saving} onChange={e => setNotes(current => current.map(n => n.id === note.id ? { ...n, text: e.target.value } : n))} className="min-w-0 flex-1 rounded-lg bg-black/10 px-2 text-sm leading-6 text-[#e5e4e2]" /> : <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-6 text-[#e5e4e2]/85">{note.text}</p>}
        {editing && <button type="button" disabled={saving} aria-label={`Usuń notatkę ${index + 1}`} onClick={() => setNotes(current => current.filter(n => n.id !== note.id))} className="p-1 text-red-300"><Trash2 className="h-4 w-4" /></button>}
      </div>)}</div>
      {!notes.length && <p className="mt-3 text-sm text-[#e5e4e2]/40">Brak dodatkowych notatek.</p>}
      <button type="button" disabled={saving || notes.length >= 50} onClick={() => { setEditing(true); setNotes(current => [...current, { id: crypto.randomUUID(), text: '', checked: false }]); }} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-xs text-[#250914] disabled:opacity-40"><Plus className="h-3.5 w-3.5" />Dodaj notatkę</button>
      {(editing || dirty) && <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-[#e5e4e2]/50">{length}/1000{dirty ? ' · Niezapisane zmiany' : ''}</span>
        <div className="flex gap-2">
          <button type="button" disabled={saving} onClick={() => { setNotes(saved); setEditing(false); setError(''); }} className="rounded-lg px-3 py-2 text-sm text-[#e5e4e2]/60">Anuluj</button>
          <button type="button" disabled={saving || !dirty || length > 1000} onClick={() => void save()} className="rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#250914] disabled:opacity-40">{saving ? 'Zapisywanie…' : 'Zapisz notatki'}</button>
        </div>
      </div>}
    </>}
    {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
  </section>;
}
