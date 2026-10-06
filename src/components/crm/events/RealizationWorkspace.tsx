'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, FileText, Clock, Package, ClipboardList, Truck, UserCheck, Users, Phone, MessageSquare, Mail } from 'lucide-react';
import { systemLabel } from '@/lib/ui/systemLabels';
import EventNavigation from './EventNavigation';
import { supabase } from '@/lib/supabase/browser';
import { TechnicalDetailsView } from '@/components/crm/locations/LocationTechnicalDetails';
import { RealizationPanel } from './RealizationPanel';
const date = (v: any) => (v ? new Date(v).toLocaleString('pl-PL') : 'Termin nieustalony');
const safeUrl = (s: string) => {
  try {
    const u = new URL(s);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
};
export default function RealizationWorkspace({ initialData: d }: { initialData: any }) {
  const [responsibilities, setResponsibilities] = useState<any[]>([]);
  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase.rpc('get_event_responsibility_team', { p_event_id: d.id });
      if (!error) setResponsibilities(data || []);
    };
    void load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [d.id]);
  const team = (d.team || []).map((person: any) => ({ ...person, responsibility_roles: responsibilities.find(member => member.employee_id === person.employee_id)?.responsibility_roles || [] }));
  for (const member of responsibilities) {
    if (!team.some((person: any) => person.employee_id === member.employee_id)) team.push({
      ...member, name: `${member.employee.name} ${member.employee.surname || ''}`.trim(),
      phone: member.employee.phone_number, email: member.employee.email,
    });
  }
  const router = useRouter();
  const params = useSearchParams();
  const tabs = [
    { id: 'overview', label: 'Przegląd', icon: FileText },
    { id: 'phases', label: 'Timeline', icon: Clock },
    { id: 'agenda', label: 'Agenda', icon: ClipboardList },
    { id: 'equipment', label: 'Sprzęt', icon: Package },
    { id: 'team', label: 'Zespół', icon: Users },
    { id: 'logistics', label: 'Logistyka', icon: Truck },
    { id: 'subcontractors', label: 'Podwykonawcy', icon: UserCheck },
    { id: 'files', label: 'Pliki', icon: FileText },
  ];
  const selected = params.get('tab') || 'overview';
  const tab = tabs.some(item => item.id === selected) ? selected : 'overview';
  const [error, setError] = useState('');
  const setTab = (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set('tab', id);
    router.replace(`?${next.toString()}`, { scroll: false });
  };
  const file = async (f: any) => {
    setError('');
    let url = safeUrl(f.url || '');
    if (!url && f.path) {
      const r = await supabase.storage.from('event-files').createSignedUrl(f.path, 300);
      if (r.error) {
        setError('Nie udało się otworzyć pliku.');
        return;
      }
      url = r.data.signedUrl;
    }
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else setError('Brak adresu pliku.');
  };
  const card = (key: string, title: string, body: any) => (
    <article key={key} className="mb-4 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 sm:p-6">
      <h3 className="text-lg font-light uppercase">{title}</h3>
      <div className="mt-2 whitespace-pre-wrap text-sm opacity-90">{body}</div>
    </article>
  );
  return (
    <main className="space-y-6 p-3 text-[#e5e4e2] sm:p-6">
      <header className="flex items-start gap-4">
        <a href="/crm/events" aria-label="Wróć do wydarzeń" className="mt-1 text-[#e5e4e2]/70 hover:text-[#d3bb73]"><ArrowLeft className="h-6 w-6" /></a>
        <div><h1 className="text-2xl font-light uppercase">{d.name}</h1><p className="mt-1 text-sm text-[#e5e4e2]/60">{date(d.event_date)} – {date(d.event_end_date)}</p></div>
      </header>
      <EventNavigation tabs={tabs} activeTab={tab} onChange={setTab} />
      <div className={tab === 'overview' ? 'grid items-start gap-6 lg:grid-cols-3' : ''}>
      <div className={tab === 'overview' ? 'lg:col-span-2' : ''}>
      {tab === 'overview' && (
        <>
          {card(
            'scope',
            'Zakres realizacji',
            <>
              {date(d.event_date)} – {date(d.event_end_date)}
              <p>{d.description || 'Brak opisu realizacji'}</p>
            </>,
          )}
          {card(
            'location',
            d.location?.name || 'Lokalizacja',
            <>
              {d.location?.address} {d.location?.city}
              <p>{d.location?.notes}</p>
              <TechnicalDetailsView value={d.location?.technical_details} />
              <p>
                {d.location?.contact_name} {d.location?.phone}
              </p>
              {(Array.isArray(d.location?.rooms) ? d.location.rooms : [])
                .filter((r: any) => d.location?.selected_rooms?.includes(r.id))
                .map((r: any) => (
                  <div key={r.id}>
                    {r.name}
                    {r.id === d.location.stage_room_id ? ' · Scena / DJ' : ''} {r.notes}
                    <TechnicalDetailsView value={r.technical} />
                  </div>
                ))}
            </>,
          )}
          {card(
            'contact',
            'Kontakt na wydarzeniu',
            <>
              {d.contact?.name}
              <p>{d.contact?.phone}</p>
              <p>{d.contact?.email}</p>
            </>,
          )}
        </>
      )}
      {tab === 'phases' &&
        (d.phases?.length ? (
          d.phases.map((p: any) =>
            card(
              p.id,
              p.name,
              <>
                {date(p.start)} – {date(p.end)}
                <p>{p.description}</p>
              </>,
            ),
          )
        ) : (
          <p>Brak faz.</p>
        ))}
      {tab === 'equipment' &&
        (d.equipment?.length ? (
          d.equipment.map((item: any) =>
            card(
              item.id,
              item.name,
              <>
                <p>Ilość: {item.quantity}</p>
                <p>{item.loaded ? 'Załadowane' : 'Do załadunku'}</p>
                <p>{item.notes}</p>
              </>,
            ),
          )
        ) : (
          <p>Brak przypisanego sprzętu.</p>
        ))}
      {tab === 'agenda' && (
        <>
          {d.agenda?.length ? (
            d.agenda.map((a: any) => card(a.id, `${a.time || ''} ${a.title}`, a.description))
          ) : (
            <p>Brak pozycji agendy.</p>
          )}
          {d.agenda_notes?.map((n: any) => card(n.id, 'Notatka do agendy', n.content))}
        </>
      )}
      {tab === 'team' && (
        <section className="rounded-xl bg-[#1c1f33] p-4 sm:p-6">
          <h2 className="mb-4 text-lg uppercase">Zespół wydarzenia</h2>
          {team.length ? <div className="space-y-3">{team.map((member: any) => {
            const phone = (member.phone || '').replace(/[^+0-9]/g, '');
            return <article key={member.id} className="flex flex-col gap-3 rounded-lg bg-black/15 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h3 className="font-medium">{member.name}</h3>
                <p className="text-sm text-[#d3bb73]">{member.responsibility_roles?.length ? member.responsibility_roles.join(' · ') : systemLabel(member.role, 'role', { preserveCustom: true, fallback: 'Członek zespołu' })}</p>
                <p className="mt-1 text-xs text-[#e5e4e2]/60">{member.status === 'accepted' ? 'Udział potwierdzony' : 'Oczekuje na potwierdzenie'}</p>
                {member.responsibilities && <p className="mt-2 whitespace-pre-wrap text-sm">{member.responsibilities}</p>}
                {member.phone && <p className="mt-2 text-sm text-[#e5e4e2]/70">{member.phone}</p>}
                {!phone && !member.email && <p className="mt-2 text-sm text-[#e5e4e2]/60">Brak danych kontaktowych.</p>}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {phone && <>
                  <a href={`tel:${phone}`} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73]"><Phone size={16} />Zadzwoń</a>
                  <a href={`sms:${phone}`} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73]"><MessageSquare size={16} />SMS</a>
                </>}
                {member.email && <a href={`mailto:${encodeURIComponent(member.email)}`} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73]"><Mail size={16} />E-mail</a>}
              </div>
            </article>;
          })}</div> : <p className="text-sm text-[#e5e4e2]/60">Brak osób przypisanych do wydarzenia.</p>}
        </section>
      )}
      {tab === 'logistics' &&
        (d.vehicles?.length ? (
          d.vehicles.map((v: any) =>
            card(
              v.id,
              v.name || 'Pojazd',
              <>
                <p>Kierowca: {v.driver || 'Nieprzypisany'}</p>
                <p>Wyjazd: {date(v.departure)}</p>
                <p>Przyjazd: {date(v.arrival)}</p>
                <p>Powrót: {date(v.return)}</p>
                <p>{v.origin}</p>
                <p>{v.notes}</p>
              </>,
            ),
          )
        ) : (
          <p>Brak pojazdów.</p>
        ))}
      {tab === 'subcontractors' &&
        (d.subcontractors?.length ? (
          d.subcontractors.map((s: any) =>
            card(
              s.id,
              s.name,
              <>
                <p>
                  {s.contact_name} · {s.phone} · {s.email}
                </p>
                <p>{s.scope}</p>
                <p>{s.deliverables}</p>
                <p>{s.guidelines}</p>
                <p>{s.notes}</p>
                <p>
                  {date(s.start)} – {date(s.end)}
                </p>
              </>,
            ),
          )
        ) : (
          <p>Brak podwykonawców.</p>
        ))}
      {tab === 'files' &&
        (d.files?.length ? (
          d.files.map((f: any) => (
            <button
              key={f.id}
              onClick={() => void file(f)}
              className="mb-2 block rounded-lg bg-white/5 p-3 text-[#d3bb73]"
            >
              {f.name || 'Plik'}
            </button>
          ))
        ) : (
          <p>Brak plików operacyjnych.</p>
        ))}
      </div>
      {tab === 'overview' && <aside><RealizationPanel eventId={d.id} /></aside>}
      </div>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
    </main>
  );
}
