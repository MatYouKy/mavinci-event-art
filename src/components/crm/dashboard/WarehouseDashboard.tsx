import Link from 'next/link';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { OPERATIONAL_LABELS } from '@/lib/CRM/events/operationalStages';
import { Package, Calendar, CheckSquare, AlertTriangle } from 'lucide-react';

export default async function WarehouseDashboard({ employeeId }: { employeeId: string }) {
  const db = createSupabaseServerClient(cookies());
  const [damaged, events, assignments] = await Promise.all([
    db.from('equipment_units').select('id,equipment_id,unit_serial_number,condition_notes,equipment:equipment_items(name)', { count: 'exact' }).eq('status', 'damaged').order('updated_at', { ascending: false }).limit(20),
    db.from('events').select('id,name,event_date,status').in('status', ['offer_accepted', 'in_preparation', 'ready_for_live']).order('event_date', { ascending: true }).limit(20),
    db.from('task_assignees').select('task_id').eq('employee_id', employeeId),
  ]);
  const taskIds = [...new Set((assignments.data || []).map(row => row.task_id))];
  const tasks = assignments.error ? { data: null, error: assignments.error } : taskIds.length
    ? await db.from('tasks').select('id,title,due_date,status').in('id', taskIds).or('is_inquiry.is.null,is_inquiry.eq.false').in('status', ['todo', 'in_progress']).order('due_date', { ascending: true, nullsFirst: false }).limit(20)
    : { data: [], error: null };
  const eventIds = (events.data || []).map(row => row.id);
  const stages = eventIds.length ? await db.rpc('get_event_operational_states', { p_event_ids: eventIds }) : { data: [], error: null };
  const statusById = new Map<string, string>((stages.data || []).map((row: any) => [row.event_id, row.status]));
  const card = 'rounded-xl bg-[#3b1426] p-4 sm:p-5';
  const rowStyle = 'block rounded-lg bg-black/15 p-3 transition-colors hover:bg-white/5';
  const date = (value: string | null) => value ? new Date(value).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' }) : 'Bez terminu';
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-3 sm:p-6">
      <header>
        <h1 className="text-xl uppercase text-[#e5e4e2]">Magazyn i logistyka</h1>
        <p className="mt-1 text-sm text-[#e5e4e2]/60">Przygotowanie wydarzeń, stan sprzętu i Twoje zadania.</p>
      </header>
      <nav aria-label="Szybki dostęp" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[{ href: '/crm/equipment', label: 'Sprzęt', Icon: Package }, { href: '/crm/events', label: 'Wydarzenia', Icon: Calendar }, { href: '/crm/tasks/mine', label: 'Moje zadania', Icon: CheckSquare }].map(({ href, label, Icon }) => (
          <Link key={href} href={href} className={`${card} flex items-center gap-3 text-[#d3bb73] hover:bg-[#4b1b30]`}><Icon size={22} /><span>{label}</span></Link>
        ))}
      </nav>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className={card}>
          <h2 className="mb-3 flex items-center gap-2 uppercase"><AlertTriangle className="text-red-300" size={20} />Uszkodzony sprzęt{damaged.count != null && <span className="text-red-300">({damaged.count})</span>}</h2>
          {damaged.error ? <p role="alert">Nie udało się pobrać uszkodzonego sprzętu. Odśwież stronę.</p> : !damaged.data?.length ? <p className="text-sm text-[#e5e4e2]/60">Brak egzemplarzy oznaczonych jako uszkodzone.</p> : <div className="space-y-2">{damaged.data.map((unit: any) => (
            <Link key={unit.id} href={`/crm/equipment/${unit.equipment_id}`} className={rowStyle}>
              <p className="text-[#e5e4e2]">{(Array.isArray(unit.equipment) ? unit.equipment[0] : unit.equipment)?.name || 'Sprzęt'} <span className="text-xs text-red-300">· Uszkodzony</span></p>
              {unit.unit_serial_number && <p className="mt-1 text-xs text-[#e5e4e2]/60">Numer seryjny: {unit.unit_serial_number}</p>}
              {unit.condition_notes && <p className="mt-1 line-clamp-2 text-sm text-[#e5e4e2]/70">{unit.condition_notes}</p>}
            </Link>
          ))}</div>}
          {(damaged.count || 0) > 20 && <p className="mt-3 text-xs text-[#e5e4e2]/60">Pokazano 20 ostatnio aktualizowanych egzemplarzy.</p>}
        </section>
        <section className={card}>
          <h2 className="mb-3 uppercase">Wydarzenia do przygotowania</h2>
          {events.error || stages.error ? <p role="alert">Nie udało się pobrać wydarzeń. Odśwież stronę.</p> : !events.data?.length ? <p className="text-sm text-[#e5e4e2]/60">Brak wydarzeń oczekujących na przygotowanie.</p> : <div className="space-y-2">{events.data.map(event => (
            <Link key={event.id} href={`/crm/events/${event.id}`} className={rowStyle}>
              <p>{event.name}</p><p className="mt-1 text-sm text-[#d3bb73]">{date(event.event_date)} · {OPERATIONAL_LABELS[statusById.get(event.id) || event.status] || 'Do potwierdzenia'}</p>
            </Link>
          ))}</div>}
          <Link href="/crm/events" className="mt-4 inline-block text-sm text-[#d3bb73]">Przejdź do wydarzeń →</Link>
        </section>
        <section className={`${card} lg:col-span-2`}>
          <h2 className="mb-3 uppercase">Moje zadania do wykonania</h2>
          {tasks.error ? <p role="alert">Nie udało się pobrać Twoich zadań. Odśwież stronę.</p> : !tasks.data?.length ? <p className="text-sm text-[#e5e4e2]/60">Nie masz otwartych przypisanych zadań.</p> : <div className="grid gap-2 sm:grid-cols-2">{tasks.data.map(task => (
            <Link key={task.id} href={`/crm/tasks/${task.id}`} className={rowStyle}><p>{task.title}</p><p className="mt-1 text-xs text-[#e5e4e2]/60">Termin: {date(task.due_date)}</p></Link>
          ))}</div>}
          <Link href="/crm/tasks/mine" className="mt-4 inline-block text-sm text-[#d3bb73]">Wszystkie moje zadania →</Link>
        </section>
      </div>
    </main>
  );
}
