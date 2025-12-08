'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { Clock, Plus, Trash2, Save, FileDown, Printer, ChevronRight, List } from 'lucide-react';
import { dataUriToBlob } from '@/app/crm/events/[id]/helpers/blobPDFHelper';
import { buildAgendaHtml } from '@/app/crm/events/[id]/helpers/buildAgendaPdf';

// YYYY-MM-DD + HH:MM -> YYYY-MM-DDTHH:MM:00.000Z
const buildIsoDateTime = (dateOnly: string, timeStr: string): string | null => {
  if (!dateOnly || !timeStr) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  if (!/^\d{2}:\d{2}$/.test(timeStr)) return null;

  return `${dateOnly}T${timeStr}:00.000Z`;
};

const isoToDateInput = (value?: string | null): string => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
};

const isoToTimeInput = (value?: string | null): string => {
  if (!value) return '';
  if (/^\d{2}:\d{2}$/.test(value)) return value;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(11, 16); // HH:MM
};

interface EventAgendaTabProps {
  eventId: string;
  eventName: string;
  eventDate: string;   // ISO albo YYYY-MM-DD
  startTime: string;   // ISO albo HH:MM
  endTime: string;
  clientContact: string;
}

interface AgendaItem {
  id?: string;
  time: string; // HH:MM w UI
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
  const [editMode, setEditMode] = useState(false);
  const [html2pdfReady, setHtml2pdfReady] = useState(false);

  const [agendaId, setAgendaId] = useState<string | null>(null);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);
  const [agendaNotes, setAgendaNotes] = useState<AgendaNote[]>([]);

  const normalizedEventDate = useMemo(() => isoToDateInput(eventDate), [eventDate]);

  const [startTimeInput, setStartTimeInput] = useState(() => isoToTimeInput(startTime));
  const [endTimeInput, setEndTimeInput] = useState(() => isoToTimeInput(endTime));
  const [clientContactInput, setClientContactInput] = useState(clientContact || '');

  const canManage =
    employee?.permissions?.includes('events_manage') || employee?.permissions?.includes('admin');

  useEffect(() => {
    fetchAgenda();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  useEffect(() => {
    if (!agendaId) {
      setStartTimeInput(isoToTimeInput(startTime));
      setEndTimeInput(isoToTimeInput(endTime));
      setClientContactInput(clientContact || '');
    }
  }, [startTime, endTime, clientContact, agendaId]);

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

        setStartTimeInput(isoToTimeInput(agenda.start_time) || isoToTimeInput(startTime) || '');
        setEndTimeInput(isoToTimeInput(agenda.end_time) || isoToTimeInput(endTime) || '');
        setClientContactInput(agenda.client_contact || clientContact || '');

        const { data: items, error: itemsError } = await supabase
          .from('event_agenda_items')
          .select('*')
          .eq('agenda_id', agenda.id)
          .order('order_index');

        if (itemsError) throw itemsError;

        setAgendaItems(
          (items || []).map((item) => ({
            ...item,
            time: isoToTimeInput(item.time) || '',
          })),
        );

        const { data: notes, error: notesError } = await supabase
          .from('event_agenda_notes')
          .select('*')
          .eq('agenda_id', agenda.id)
          .order('order_index');

        if (notesError) throw notesError;
        setAgendaNotes(buildNoteTree(notes || []));
      } else {
        // brak agendy – reset do propsów
        setAgendaItems([]);
        setAgendaNotes([]);
        setStartTimeInput(isoToTimeInput(startTime));
        setEndTimeInput(isoToTimeInput(endTime));
        setClientContactInput(clientContact || '');
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

  const getSortedAgendaItems = () => {
    return [...agendaItems].sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return 1;
      if (!b.time) return -1;
      return a.time.localeCompare(b.time);
    });
  };

  const handleSave = async () => {
    if (!canManage) {
      alert('Nie masz uprawnień do zapisywania agendy');
      return;
    }

    if (!eventName || !normalizedEventDate) {
      alert('Nazwa wydarzenia i data są wymagane');
      return;
    }

    const isoStart = buildIsoDateTime(normalizedEventDate, startTimeInput);
    const isoEnd = buildIsoDateTime(normalizedEventDate, endTimeInput);

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
              event_date: normalizedEventDate,
              start_time: isoStart,
              end_time: isoEnd,
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
            event_date: normalizedEventDate,
            start_time: isoStart,
            end_time: isoEnd,
            client_contact: clientContactInput || null,
          })
          .eq('id', currentAgendaId);

        if (updateError) throw updateError;
      }

      // items
      await supabase.from('event_agenda_items').delete().eq('agenda_id', currentAgendaId);

      if (agendaItems.length > 0) {
        const sortedItems = getSortedAgendaItems();
        const { error: itemsError } = await supabase.from('event_agenda_items').insert(
          sortedItems.map((item, index) => ({
            agenda_id: currentAgendaId,
            time: buildIsoDateTime(normalizedEventDate, item.time),
            title: item.title,
            description: item.description,
            order_index: index,
          })),
        );

        if (itemsError) throw itemsError;
      }

      // notes
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
      setEditMode(false);
    } catch (err) {
      console.error('Error saving agenda:', err);
      alert('Wystąpił błąd podczas zapisywania agendy');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = async () => {
    if (agendaId) {
      await fetchAgenda();
    } else {
      setAgendaItems([]);
      setAgendaNotes([]);
      setStartTimeInput(isoToTimeInput(startTime));
      setEndTimeInput(isoToTimeInput(endTime));
      setClientContactInput(clientContact || '');
    }
    setEditMode(false);
  };

  const handleGeneratePDF = async () => {
    if (!agendaId) {
      alert('Najpierw zapisz agendę');
      return;
    }

    try {
      setGenerating(true);

      // 1. Zbuduj HTML agendy
      const html = buildAgendaHtml({
        eventName,
        eventDate: normalizedEventDate, // YYYY-MM-DD
        startTime: startTimeInput,
        endTime: endTimeInput,
        clientContact: clientContactInput,
        agendaItems: getSortedAgendaItems(),
      });

      // 2. Dynamiczny import html2pdf.js (działa tylko w przeglądarce)
      const { default: html2pdf } = await import('html2pdf.js');
      const html2pdfFn: any = (html2pdf as any) || html2pdf;

      // 3. Tworzymy tymczasowy element z HTML-em
      const element = document.createElement('div');
      element.innerHTML = html;

      const opt: any = {
        margin: 10,
        filename: `agenda-${eventName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      };

      // 4. Generujemy PDF jako Blob
      const worker = html2pdfFn().from(element).set(opt).toPdf();
      const pdfBlob: Blob = await worker.output('blob');

      // 5. Zapisz PDF do storage i event_files
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const fileName = `agenda-${eventName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${timestamp}.pdf`;
      const storagePath = `${eventId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('event-files')
        .upload(storagePath, pdfBlob, {
          contentType: 'application/pdf',
          upsert: false,
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        alert('Błąd podczas zapisywania pliku');
      } else {
        const { data: { publicUrl } } = supabase.storage
          .from('event-files')
          .getPublicUrl(storagePath);

        await supabase.from('event_files').insert([
          {
            event_id: eventId,
            folder_id: null,
            name: fileName,
            original_name: fileName,
            file_path: storagePath,
            file_size: pdfBlob.size,
            mime_type: 'application/pdf',
            thumbnail_url: null,
            uploaded_by: employee?.id,
          },
        ]);

        alert('Agenda PDF została zapisana w zakładce Pliki');
      }

      // 6. Podgląd PDF w nowej karcie
      const previewUrl = URL.createObjectURL(pdfBlob);
      window.open(previewUrl, '_blank');
    } catch (err) {
      console.error('Error generating PDF:', err);
      alert('Wystąpił błąd podczas generowania PDF (szczegóły w konsoli)');
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ((window as any).html2pdf) {
      setHtml2pdfReady(true);
      return;
    }
  
    const script = document.createElement('script');
    script.src =
      'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.9.3/html2pdf.bundle.min.js';
    script.async = true;
    script.onload = () => setHtml2pdfReady(true);
    script.onerror = () => console.error('Nie udało się załadować html2pdf.js');
    document.body.appendChild(script);
  
    return () => {
      // opcjonalnie usuwanie skryptu przy unmount
      document.body.removeChild(script);
    };
  }, []);

  const addAgendaItem = (afterIndex?: number) => {
    const newItem: AgendaItem = {
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

  const removeAgendaItem = (index: number) => {
    setAgendaItems(agendaItems.filter((_, i) => i !== index));
  };

  const updateAgendaItem = (index: number, field: keyof AgendaItem, value: string) => {
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

  const renderNoteEdit = (note: AgendaNote, depth: number = 0) => {
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
        {note.children && note.children.map((child) => renderNoteEdit(child, depth + 1))}
      </div>
    );
  };

  const renderNoteView = (note: AgendaNote, depth: number = 0) => {
    const indent = depth * 24;
    return (
      <div key={note.id} style={{ marginLeft: `${indent}px` }} className="py-1">
        <div className="flex gap-2 text-sm text-[#e5e4e2]">
          <span className="mt-1 text-[#d3bb73]">•</span>
          <span>{note.content}</span>
        </div>
        {note.children && note.children.map((child) => renderNoteView(child, depth + 1))}
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
      {/* Nagłówek + akcje */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-light text-[#e5e4e2]">Agenda wydarzenia</h2>
        <div className="flex gap-2">
          {canManage && !editMode && (
            <button
              onClick={() => setEditMode(true)}
              className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/40 px-4 py-2 text-[#d3bb73] hover:bg-[#d3bb73]/10"
            >
              <List className="h-4 w-4" />
              <span>Edytuj agendę</span>
            </button>
          )}

          {canManage && editMode && (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                <span>{saving ? 'Zapisywanie...' : 'Zapisz'}</span>
              </button>
              <button
                onClick={handleCancelEdit}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/40 px-4 py-2 text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50"
              >
                <span>Anuluj</span>
              </button>
            </>
          )}

          {!editMode && agendaId && (
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
        {/* Podstawowe informacje */}
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
              {editMode && canManage ? (
                <input
                  type="time"
                  value={startTimeInput}
                  onChange={(e) => setStartTimeInput(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              ) : (
                <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]/80">
                  {startTimeInput || '--:--'}
                </div>
              )}
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Godzina zakończenia</label>
              {editMode && canManage ? (
                <input
                  type="time"
                  value={endTimeInput}
                  onChange={(e) => setEndTimeInput(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              ) : (
                <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]/80">
                  {endTimeInput || '--:--'}
                </div>
              )}
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

        {/* Harmonogram */}
        <div className="space-y-4 rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
          <h3 className="text-lg font-medium text-[#e5e4e2]">Harmonogram</h3>

          {/* TRYB PODGLĄDU – elegancka tabela */}
          {!editMode && (
            <div className="overflow-x-auto rounded-lg border border-[#d3bb73]/20 bg-[#0f1119]">
              {agendaItems.length === 0 ? (
                <div className="py-8 text-center text-[#e5e4e2]/60">
                  Brak etapów w harmonogramie
                  {canManage && (
                    <div className="mt-4">
                      <button
                        onClick={() => setEditMode(true)}
                        className="rounded-lg border border-[#d3bb73]/40 px-4 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/10"
                      >
                        Dodaj harmonogram
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <table className="min-w-full text-sm text-left">
                  <thead className="border-b border-[#d3bb73]/20 bg-[#151726] text-xs uppercase text-[#e5e4e2]/60">
                    <tr>
                      <th className="px-4 py-3 w-32">Godzina</th>
                      <th className="px-4 py-3 w-64">Etap</th>
                      <th className="px-4 py-3">Opis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getSortedAgendaItems().map((item, idx) => (
                      <tr
                        key={`${item.time}-${item.title}-${idx}`}
                        className="border-b border-[#d3bb73]/10 last:border-0"
                      >
                        <td className="px-4 py-3 align-top text-[#e5e4e2]/80">
                          {item.time || '--:--'}
                        </td>
                        <td className="px-4 py-3 align-top font-medium text-[#e5e4e2]">
                          {item.title || '—'}
                        </td>
                        <td className="px-4 py-3 align-top text-[#e5e4e2]/80 whitespace-pre-wrap">
                          {item.description || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TRYB EDYCJI – karty jak wcześniej */}
          {editMode && (
            <div className="space-y-3">
              {agendaItems.length === 0 ? (
                <div className="py-8 text-center">
                  <button
                    onClick={() => addAgendaItem()}
                    className="mx-auto flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-4 py-2 text-[#d3bb73] hover:bg-[#d3bb73]/20"
                  >
                    <Plus className="h-5 w-5" />
                    <span>Dodaj pierwszy etap</span>
                  </button>
                </div>
              ) : (
                getSortedAgendaItems().map((item) => {
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
                              className="rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-1 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                            />
                            <input
                              type="text"
                              value={item.title}
                              onChange={(e) =>
                                updateAgendaItem(originalIndex, 'title', e.target.value)
                              }
                              placeholder="Tytuł etapu..."
                              className="flex-1 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-1 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                            />
                          </div>
                          <textarea
                            value={item.description}
                            onChange={(e) =>
                              updateAgendaItem(originalIndex, 'description', e.target.value)
                            }
                            placeholder="Opis etapu..."
                            rows={2}
                            className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                          />
                        </div>
                        <button
                          onClick={() => removeAgendaItem(originalIndex)}
                          className="flex-shrink-0 p-2 text-red-400/60 hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex justify-center">
                        <button
                          onClick={() => addAgendaItem(originalIndex)}
                          className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 px-3 py-1.5 text-sm text-[#d3bb73]/80 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                        >
                          <Plus className="h-4 w-4" />
                          <span>Dodaj kolejny etap</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Uwagi */}
        <div className="space-y-4 rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-[#e5e4e2]">Uwagi</h3>
            {canManage && editMode && (
              <button
                onClick={() => addNote(0)}
                className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-3 py-1.5 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20"
              >
                <Plus className="h-4 w-4" />
                <span>Dodaj uwagę</span>
              </button>
            )}
          </div>

          {!editMode && (
            <div className="space-y-1">
              {agendaNotes.length === 0 && (
                <div className="py-4 text-center text-[#e5e4e2]/60">
                  Brak uwag do agendy.
                </div>
              )}
              {agendaNotes.map((note) => renderNoteView(note))}
            </div>
          )}

          {editMode && (
            <div className="space-y-2">
              {agendaNotes.map((note) => renderNoteEdit(note))}
              {agendaNotes.length === 0 && (
                <div className="py-4 text-center text-[#e5e4e2]/60">
                  Brak uwag. Dodaj pierwszą uwagę.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}