'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
const labels: Record<string, string> = { contact_form: 'Formularz kontaktowy', webhook: 'Webhook', submission: 'Formularz WWW', marketing: 'Wiadomość z Meta' };
export default function InquiryIntakeReview({ onChanged, inquiries }: { onChanged: () => void; inquiries: Array<{ id: string; title: string }> }) {
 const [rows, setRows] = useState<any[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
 const [decision, setDecision] = useState<{ row: any; action: string } | null>(null);
 const [target, setTarget] = useState(''); const [reason, setReason] = useState('');
 const { showSnackbar } = useSnackbar();
 const load = async () => { const { data, error } = await supabase.rpc('list_inquiry_intake_reviews'); if (error) setError(error.message); else { setRows(data || []); setError(''); } };
 useEffect(() => { void load(); }, []);
 const resolve = async (row: any, action: string) => {
  if (busy) return;
  if (!reason.trim() || (action === 'link' && !target)) return;
  setBusy(true);
  try { const { error } = await supabase.rpc('resolve_inquiry_intake_review', { p_kind: row.source_kind, p_source: row.source_id, p_action: action, p_reason: reason, p_inquiry: target?.trim() || null }); if (error) throw error; setDecision(null); await load(); onChanged(); showSnackbar('Zapisano decyzję dotyczącą źródła.', 'success'); }
  catch (error: any) { showSnackbar(error.message, 'error'); } finally { setBusy(false); }
 };
 return <details className="rounded-xl bg-[#1c1f33] p-4"><summary className="cursor-pointer text-sm text-[#d3bb73]">Kontrola źródeł — do rozstrzygnięcia: {rows.length}</summary>
 <p className="mt-3 text-xs opacity-60">Sprawdź wcześniejszą obsługę przed utworzeniem nowego zapytania. Możesz powiązać zgłoszenie z istniejącą sprawą albo wykluczyć je z lejka z podaniem powodu.</p>
 {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
 {rows.map(row => <article key={`${row.source_kind}-${row.source_id}`} className="mt-3 rounded-lg bg-black/20 p-3"><p className="text-xs opacity-60">{labels[row.source_kind]}</p><p className="my-2 whitespace-pre-wrap text-sm">{row.description}</p><div className="flex flex-wrap gap-4 text-xs"><button disabled={busy} onClick={() => { setDecision({ row, action: 'create' }); setTarget(''); setReason(''); }}>Utwórz zapytanie</button><button disabled={busy} onClick={() => { setDecision({ row, action: 'link' }); setTarget(''); setReason(''); }}>Powiąż z zapytaniem</button><button disabled={busy} onClick={() => { setDecision({ row, action: 'ignore' }); setTarget(''); setReason(''); }}>Wyklucz z lejka</button></div></article>)}
 {decision && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-lg space-y-4 rounded-xl bg-[#1c1f33] p-6"><h3>Rozstrzygnij zgłoszenie</h3>
 {decision.action === 'link' && <label className="block text-sm">Istniejące zapytanie<select value={target} onChange={e => setTarget(e.target.value)} className="mt-2 w-full rounded bg-black/20 p-3"><option value="">Wybierz zapytanie</option>{inquiries.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
 <label className="block text-sm">Powód decyzji / wynik sprawdzenia historii<textarea value={reason} onChange={e => setReason(e.target.value)} rows={4} className="mt-2 w-full rounded border border-white/10 bg-black/20 p-3" /></label>
 <div className="flex justify-end gap-4"><button disabled={busy} onClick={() => setDecision(null)}>Anuluj</button><button disabled={busy || !reason.trim() || (decision.action === 'link' && !target)} onClick={() => void resolve(decision.row,decision.action)} className="rounded bg-[#d3bb73] px-4 py-2 text-[#1c1f33] disabled:opacity-40">Zapisz decyzję</button></div></div></div>}
 </details>;
}
