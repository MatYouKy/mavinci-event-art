'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { Clock, Plus, Trash2, Save, FileDown, Printer, ChevronRight } from 'lucide-react';

const isoToDateInput = (value?: string | null): string => {
  if (!value) return '';

  // jeśli już jest w formacie YYYY-MM-DD – zostaw
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';

  // YYYY-MM-DD
  return d.toISOString().slice(0, 10);
};

const isoToTimeInput = (value?: string | null): string => {
  if (!value) return '';

  // jeśli już jest HH:MM – zostaw
  if (/^\d{2}:\d{2}$/.test(value)) return value;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';

  // HH:MM
  return d.toISOString().slice(11, 16);
};

interface EventAgendaTabProps {
  eventId: string;
  eventName: string;
  eventDate: string;
  startTime: string;        // z logów / rodzica (np. "12:00")
  endTime: string;
  clientContact: string;    // z logów / rodzica
}

interface AgendaItem {
  id?: string;
  time: string;
  title: string;
  description: string;
  order_index: number;
}

interface AgendaNote {
  id?: string;
  content: string;
  order_index: number;
  level: number;
  parent_id: string | null;
  children?: AgendaNote[];
}

export default function EventAgendaTab({
  eventId,
  eventName,
  eventDate,
  startTime,
  endTime,
  clientContact,
}: EventAgendaTabProps) {
  const { employee } = useCurrentEmployee();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [startTimeInput, setStartTimeInput] = useState(() => isoToTimeInput(startTime));
  const [endTimeInput, setEndTimeInput] = useState(() => isoToTimeInput(endTime));
  const [clientContactInput, setClientContactInput] = useState(clientContact || '');

  const [agendaId, setAgendaId] = useState<string | null>(null);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);
  const [agendaNotes, setAgendaNotes] = useState<AgendaNote[]>([]);

  const normalizedEventDate = useMemo(() => isoToDateInput(eventDate), [eventDate]);
  const normalizedStartTime = useMemo(() => isoToTimeInput(startTime), [startTime]);
  const normalizedEndTime = useMemo(() => isoToTimeInput(endTime), [endTime]);
  const canManage =
    employee?.permissions?.includes('events_manage') || employee?.permissions?.includes('admin');

  // Gdy propsy z wydarzenia się zmienią (np. po załadowaniu eventDetails w rodzicu),
  // nadpisujemy lokalne inputy, o ile agenda jeszcze nie istnieje
  useEffect(() => {
    if (!agendaId) {
      setStartTimeInput(startTime || '');
      setEndTimeInput(endTime || '');
      setClientContactInput(clientContact || '');
    }
  }, [startTime, endTime, clientContact, agendaId]);

  useEffect(() => {
    fetchAgenda();
  }, [eventId]);

  const fetchAgenda = async () => {
    try {
      setLoading(true);

      const { data: agenda, error: agendaError } = await supabase
        .from('event_agendas')
        .select('*')
        .eq('event_id', eventId)
        .maybeSingle();

      if (agendaError && agendaError.code !== 'PGRST116') throw agendaError;

      if (agenda) {
        setAgendaId(agenda.id);

        // Jeśli agenda istnieje, preferujemy jej dane,
        // ale fallbackiem są wartości z wydarzenia (propsy/logi)
        setStartTimeInput(agenda.start_time || startTime || '');
        setEndTimeInput(agenda.end_time || endTime || '');
        setClientContactInput(agenda.client_contact || clientContact || '');

        const { data: items, error: itemsError } = await supabase
          .from('event_agenda_items')
          .select('*')
          .eq('agenda_id', agenda.id)
          .order('order_index');

        if (itemsError) throw itemsError;
        setAgendaItems(items || []);

        const { data: notes, error: notesError } = await supabase
          .from('event_agenda_notes')
          .select('*')
          .eq('agenda_id', agenda.id)
          .order('order_index');

        if (notesError) throw notesError;
        setAgendaNotes(buildNoteTree(notes || []));
      }
    } catch (err) {
      console.error('Error fetching agenda:', err);
    } finally {
      setLoading(false);
    }
  };

  const buildNoteTree = (flatNotes: any[]): AgendaNote[] => {
    const noteMap = new Map<string, AgendaNote>();
    const rootNotes: AgendaNote[] = [];

    flatNotes.forEach((note) => {
      noteMap.set(note.id, { ...note, children: [] });
    });

    flatNotes.forEach((note) => {
      const noteWithChildren = noteMap.get(note.id)!;
      if (note.parent_id) {
        const parent = noteMap.get(note.parent_id);
        if (parent) {
          parent.children = parent.children || [];
          parent.children.push(noteWithChildren);
        }
      } else {
        rootNotes.push(noteWithChildren);
      }
    });

    return rootNotes;
  };

  const flattenNotes = (notes: AgendaNote[], parentId: string | null = null): any[] => {
    let flat: any[] = [];
    notes.forEach((note, index) => {
      flat.push({
        ...note,
        parent_id: parentId,
        order_index: index,
      });
      if (note.children && note.children.length > 0) {
        flat = [...flat, ...flattenNotes(note.children, note.id!)];
      }
    });
    return flat;
  };

  const handleSave = async () => {
    if (!canManage) {
      alert('Nie masz uprawnień do zapisywania agendy');
      return;
    }

    if (!eventName || !eventDate) {
      alert('Nazwa wydarzenia i data są wymagane');
      return;
    }

    try {
      setSaving(true);

      let currentAgendaId = agendaId;

      if (!currentAgendaId) {
        const { data: newAgenda, error: agendaError } = await supabase
          .from('event_agendas')
          .insert([
            {
              event_id: eventId,
              event_name: eventName,
              event_date: eventDate,
              start_time: startTimeInput || null,
              end_time: endTimeInput || null,
              client_contact: clientContactInput || null,
              created_by: employee?.id,
            },
          ])
          .select()
          .single();

        if (agendaError) throw agendaError;
        currentAgendaId = newAgenda.id;
        setAgendaId(currentAgendaId);
      } else {
        const { error: updateError } = await supabase
          .from('event_agendas')
          .update({
            event_name: eventName,
            event_date: eventDate,
            start_time: startTimeInput || null,
            end_time: endTimeInput || null,
            client_contact: clientContactInput || null,
          })
          .eq('id', currentAgendaId);

        if (updateError) throw updateError;
      }

      await supabase.from('event_agenda_items').delete().eq('agenda_id', currentAgendaId);

      if (agendaItems.length > 0) {
        const sortedItems = getSortedAgendaItems();
        const { error: itemsError } = await supabase.from('event_agenda_items').insert(
          sortedItems.map((item, index) => ({
            agenda_id: currentAgendaId,
            time: item.time,
            title: item.title,
            description: item.description,
            order_index: index,
          })),
        );

        if (itemsError) throw itemsError;
      }

      await supabase.from('event_agenda_notes').delete().eq('agenda_id', currentAgendaId);

      const flatNotes = flattenNotes(agendaNotes);
      if (flatNotes.length > 0) {
        const notesWithIds = new Map<string, string>();

        for (const note of flatNotes) {
          const { data: insertedNote, error: noteError } = await supabase
            .from('event_agenda_notes')
            .insert([
              {
                agenda_id: currentAgendaId,
                parent_id:
                  note.parent_id && notesWithIds.has(note.parent_id)
                    ? notesWithIds.get(note.parent_id)
                    : null,
                content: note.content,
                order_index: note.order_index,
                level: note.level,
              },
            ])
            .select()
            .single();

          if (noteError) throw noteError;
          if (note.id) notesWithIds.set(note.id, insertedNote.id);
        }
      }

      alert('Agenda została zapisana');
      await fetchAgenda();
    } catch (err) {
      console.error('Error saving agenda:', err);
      alert('Wystąpił błąd podczas zapisywania agendy');
    } finally {
      setSaving(false);
    }
  };

  const handleGeneratePDF = async () => {
    if (!agendaId) {
      alert('Najpierw zapisz agendę');
      return;
    }

    try {
      setGenerating(true);

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-agenda-pdf`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ agendaId }),
        },
      );

      if (!response.ok) throw new Error('Failed to generate agenda data');

      const { htmlContent, agenda } = await response.json();

      if (typeof window !== 'undefined' && (window as any).html2pdf) {
        const html2pdf = (window as any).html2pdf;
        const element = document.createElement('div');
        element.innerHTML = htmlContent;

        const opt = {
          margin: 10,
          filename: `agenda-${agenda.event_name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        };

        const pdfBlob = await html2pdf().set(opt).from(element).outputPdf('blob');

        const fileName = `agenda_${Date.now()}.pdf`;
        const filePath = `${eventId}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('event-files')
          .upload(filePath, pdfBlob, {
            contentType: 'application/pdf',
            upsert: false,
          });

        if (uploadError) throw uploadError;

        const { error: fileRecordError } = await supabase.from('event_files').insert([
          {
            event_id: eventId,
            name: `Agenda - ${agenda.event_name}.pdf`,
            original_name: `agenda_${agenda.event_name}.pdf`,
            file_path: filePath,
            file_size: pdfBlob.size,
            mime_type: 'application/pdf',
            uploaded_by: employee?.id,
          },
        ]);

        if (fileRecordError) throw fileRecordError;

        const pdfUrl = URL.createObjectURL(pdfBlob);
        window.open(pdfUrl, '_blank');

        alert('PDF został wygenerowany i zapisany w zakładce Pliki');
      } else {
        throw new Error('html2pdf library not loaded');
      }
    } catch (err) {
      console.error('Error generating PDF:', err);
      alert('Wystąpił błąd podczas generowania PDF');
    } finally {
      setGenerating(false);
    }
  };

  const addAgendaItem = (afterIndex?: number) => {
    const newItem = {
      time: '',
      title: '',
      description: '',
      order_index: typeof afterIndex === 'number' ? afterIndex + 1 : agendaItems.length,
    };

    if (typeof afterIndex === 'number') {
      const updatedItems = [
        ...agendaItems.slice(0, afterIndex + 1),
        newItem,
        ...agendaItems.slice(afterIndex + 1),
      ];
      setAgendaItems(updatedItems);
    } else {
      setAgendaItems([...agendaItems, newItem]);
    }
  };

  const getSortedAgendaItems = () => {
    return [...agendaItems].sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return 1;
      if (!b.time) return -1;
      return a.time.localeCompare(b.time);
    });
  };

  const removeAgendaItem = (index: number) => {
    setAgendaItems(agendaItems.filter((_, i) => i !== index));
  };

  const updateAgendaItem = (index: number, field: string, value: string) => {
    const updated = [...agendaItems];
    updated[index] = { ...updated[index], [field]: value };
    setAgendaItems(updated);
  };

  const addNote = (level: number = 0, parentId: string | null = null) => {
    const newNote: AgendaNote = {
      id: `temp-${Date.now()}`,
      content: '',
      order_index: 0,
      level,
      parent_id: parentId,
      children: [],
    };

    if (parentId) {
      const addToParent = (notes: AgendaNote[]): AgendaNote[] =>
        notes.map((note) => {
          if (note.id === parentId) {
            return {
              ...note,
              children: [...(note.children || []), newNote],
            };
          }
          if (note.children) {
            return {
              ...note,
              children: addToParent(note.children),
            };
          }
          return note;
        });

      setAgendaNotes(addToParent(agendaNotes));
    } else {
      setAgendaNotes([...agendaNotes, newNote]);
    }
  };

  const updateNote = (noteId: string, content: string) => {
    const updateInTree = (notes: AgendaNote[]): AgendaNote[] =>
      notes.map((note) => {
        if (note.id === noteId) {
          return { ...note, content };
        }
        if (note.children) {
          return {
            ...note,
            children: updateInTree(note.children),
          };
        }
        return note;
      });

    setAgendaNotes(updateInTree(agendaNotes));
  };

  const removeNote = (noteId: string) => {
    const removeFromTree = (notes: AgendaNote[]): AgendaNote[] =>
      notes
        .filter((note) => note.id !== noteId)
        .map((note) => ({
          ...note,
          children: note.children ? removeFromTree(note.children) : [],
        }));

    setAgendaNotes(removeFromTree(agendaNotes));
  };

  const renderNote = (note: AgendaNote, depth: number = 0) => {
    const indent = depth * 24;
    return (
      <div key={note.id} className="space-y-2">
        <div className="flex items-start gap-2" style={{ marginLeft: `${indent}px` }}>
          <div className="flex flex-1 items-start gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-3">
            <span className="mt-1 text-[#d3bb73]">•</span>
            <input
              type="text"
              value={note.content}
              onChange={(e) => updateNote(note.id!, e.target.value)}
              placeholder="Treść uwagi..."
              disabled={!canManage}
              className="flex-1 border-none bg-transparent text-[#e5e4e2] focus:outline-none"
            />
            <div className="flex items-center gap-1">
              {note.level < 2 && canManage && (
                <button
                  onClick={() => addNote(note.level + 1, note.id!)}
                  className="p-1 text-[#d3bb73]/60 hover:text-[#d3bb73]"
                  title="Dodaj podpunkt"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
              {canManage && (
                <button
                  onClick={() => removeNote(note.id!)}
                  className="p-1 text-red-400/60 hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
        {note.children && note.children.map((child) => renderNote(child, depth + 1))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-[#e5e4e2]/60">Ładowanie agendy...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-light text-[#e5e4e2]">Agenda wydarzenia</h2>
        <div className="flex gap-2">
          {canManage && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span>{saving ? 'Zapisywanie...' : 'Zapisz'}</span>
            </button>
          )}
          {agendaId && (
            <>
              <button
                onClick={handleGeneratePDF}
                disabled={generating}
                className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 px-4 py-2 text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50"
              >
                <FileDown className="h-4 w-4" />
                <span>{generating ? 'Generowanie...' : 'Generuj PDF'}</span>
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 px-4 py-2 text-[#d3bb73] hover:bg-[#d3bb73]/10"
              >
                <Printer className="h-4 w-4" />
                <span>Drukuj</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <div className="space-y-4 rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
          <h3 className="text-lg font-medium text-[#e5e4e2]">
            Podstawowe informacje (z wydarzenia)
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa wydarzenia</label>
              <input
                type="text"
                value={eventName}
                readOnly
                className="w-full cursor-not-allowed rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]/70"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data wydarzenia</label>
              <input
                type="date"
                value={normalizedEventDate}
                readOnly
                className="w-full cursor-not-allowed rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]/70"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Godzina rozpoczęcia</label>
              <input
                type="time"
                value={normalizedStartTime}
                onChange={(e) => setStartTimeInput(e.target.value)}
                disabled={!canManage}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Godzina zakończenia</label>
              <input
                type="time"
                value={normalizedEndTime}
                onChange={(e) => setEndTimeInput(e.target.value)}
                disabled={!canManage}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kontakt do klienta</label>
              <input
                type="text"
                value={clientContactInput}
                readOnly
                className="w-full cursor-not-allowed rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]/70"
              />
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
          <h3 className="text-lg font-medium text-[#e5e4e2]">Harmonogram</h3>

          <div className="space-y-3">
            {agendaItems.length === 0 ? (
              <div className="py-8 text-center">
                {canManage && (
                  <button
                    onClick={() => addAgendaItem()}
                    className="mx-auto flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-4 py-2 text-[#d3bb73] hover:bg-[#d3bb73]/20"
                  >
                    <Plus className="h-5 w-5" />
                    <span>Dodaj pierwszy etap</span>
                  </button>
                )}
                {!canManage && <p className="text-[#e5e4e2]/60">Brak etapów w harmonogramie</p>}
              </div>
            ) : (
              getSortedAgendaItems().map((item, displayIndex) => {
                const originalIndex = agendaItems.indexOf(item);
                return (
                  <div key={originalIndex} className="space-y-2">
                    <div className="flex items-start gap-3 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-4">
                      <Clock className="mt-1 h-5 w-5 flex-shrink-0 text-[#d3bb73]" />
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="time"
                            value={item.time}
                            onChange={(e) =>
                              updateAgendaItem(originalIndex, 'time', e.target.value)
                            }
                            disabled={!canManage}
                            className="rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-1 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
                          />
                          <input
                            type="text"
                            value={item.title}
                            onChange={(e) =>
                              updateAgendaItem(originalIndex, 'title', e.target.value)
                            }
                            placeholder="Tytuł etapu..."
                            disabled={!canManage}
                            className="flex-1 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-1 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
                          />
                        </div>
                        <textarea
                          value={item.description}
                          onChange={(e) =>
                            updateAgendaItem(originalIndex, 'description', e.target.value)
                          }
                          placeholder="Opis etapu..."
                          disabled={!canManage}
                          rows={2}
                          className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
                        />
                      </div>
                      {canManage && (
                        <button
                          onClick={() => removeAgendaItem(originalIndex)}
                          className="flex-shrink-0 p-2 text-red-400/60 hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    {canManage && (
                      <div className="flex justify-center">
                        <button
                          onClick={() => addAgendaItem(originalIndex)}
                          className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 px-3 py-1.5 text-sm text-[#d3bb73]/80 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                        >
                          <Plus className="h-4 w-4" />
                          <span>Dodaj kolejny etap</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-[#e5e4e2]">Uwagi</h3>
            {canManage && (
              <button
                onClick={() => addNote(0)}
                className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-3 py-1.5 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20"
              >
                <Plus className="h-4 w-4" />
                <span>Dodaj uwagę</span>
              </button>
            )}
          </div>

          <div className="space-y-2">
            {agendaNotes.map((note) => renderNote(note))}
            {agendaNotes.length === 0 && (
              <div className="py-8 text-center text-[#e5e4e2]/60">
                Brak uwag. Dodaj pierwszą uwagę.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
