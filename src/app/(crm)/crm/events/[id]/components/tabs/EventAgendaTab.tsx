'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import {
  Clock,
  Plus,
  Trash2,
  Save,
  FileDown,
  Printer,
  ChevronRight,
  List,
  Eye,
  Download,
  Edit3,
  Check,
  X,
} from 'lucide-react';
import { buildAgendaHtml } from '@/app/(crm)/crm/events/[id]/helpers/buildAgendaPdf';
import { supabaseServer } from '@/lib/supabaseServer';
import { useEvent } from '../../../hooks/useEvent';
import { useGetContactByIdQuery } from '@/app/(crm)/crm/contacts/store/clientsApi';
import { ContactRow, OrganizationRow } from '@/app/(crm)/crm/contacts/types';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';
import { ISimpleContact } from '../../EventDetailPageClient';

// YYYY-MM-DD + HH:MM -> YYYY-MM-DDTHH:MM:00 (local time, no timezone conversion)
const buildIsoDateTime = (dateOnly: string, timeStr: string): string | null => {
  if (!dateOnly || !timeStr) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  if (!/^\d{2}:\d{2}$/.test(timeStr)) return null;

  return `${dateOnly}T${timeStr}:00`;
};

const isoToDateInput = (value?: string | null): string => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  // Extract date part without timezone conversion
  if (value.includes('T')) {
    return value.split('T')[0];
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';

  // Use local date without timezone conversion
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isoToTimeInput = (value?: string | null): string => {
  if (!value) return '';
  if (/^\d{2}:\d{2}$/.test(value)) return value;

  // Extract time part without timezone conversion
  if (value.includes('T')) {
    const timePart = value.split('T')[1];
    if (timePart) {
      return timePart.slice(0, 5); // HH:MM
    }
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';

  // Use local time without timezone conversion
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

interface EventAgendaTabProps {
  eventId: string;
  eventName: string;
  eventDate: string; // ISO albo YYYY-MM-DD
  startTime: string; // ISO albo HH:MM
  endTime: string;
  contact: ContactRow | ISimpleContact;
  organization: OrganizationRow | null;
  createdById: string;
}

interface AgendaItem {
  id?: string;
  time: string; // HH:MM w UI
  title: string;
  description: string;
  order_index: number;
  isEditing?: boolean;
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
  contact,
  organization,
  createdById,
}: EventAgendaTabProps) {
  const { employee } = useCurrentEmployee();
  const { event } = useEvent();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const [agendaId, setAgendaId] = useState<string | null>(null);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);
  const [agendaNotes, setAgendaNotes] = useState<AgendaNote[]>([]);
  const [generatedPdfPath, setGeneratedPdfPath] = useState<string | null>(null);
  const [modifiedAfterGeneration, setModifiedAfterGeneration] = useState(false);
  const [createdByEmployee, setCreatedByEmployee] = useState<{
    name: string;
    phone_number: string;
  } | null>(null);

  const normalizedEventDate = useMemo(() => isoToDateInput(eventDate), [eventDate]);

  const [startTimeInput, setStartTimeInput] = useState(() => isoToTimeInput(startTime));
  const [endTimeInput, setEndTimeInput] = useState(() => isoToTimeInput(endTime));

  const canManage =
    employee?.permissions?.includes('events_manage') || employee?.permissions?.includes('admin');

  // ✅ refs to avoid stale closures (np. setTimeout -> stary agendaId/generetedPdfPath)
  const agendaIdRef = useRef<string | null>(null);
  const generatedPdfPathRef = useRef<string | null>(null);
  const employeeRef = useRef(employee);
  const eventRef = useRef(event);
  const createdByEmployeeRef = useRef(createdByEmployee);

  useEffect(() => {
    agendaIdRef.current = agendaId;
  }, [agendaId]);

  useEffect(() => {
    generatedPdfPathRef.current = generatedPdfPath;
  }, [generatedPdfPath]);

  useEffect(() => {
    employeeRef.current = employee;
  }, [employee]);

  useEffect(() => {
    eventRef.current = event;
  }, [event]);

  useEffect(() => {
    createdByEmployeeRef.current = createdByEmployee;
  }, [createdByEmployee]);

  useEffect(() => {
    fetchAgenda();
    fetchCreatedByEmployee();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  useEffect(() => {
    if (!agendaId) {
      setStartTimeInput(isoToTimeInput(startTime));
      setEndTimeInput(isoToTimeInput(endTime));
    }
  }, [startTime, endTime, contact, agendaId]);

  const fetchCreatedByEmployee = async () => {
    const { data: Author, error } = await supabase
      .from('employees')
      .select('name, surname, phone_number')
      .eq('id', createdById)
      .maybeSingle();

    if (error) {
      console.error('[Agenda] fetchCreatedByEmployee error', error);
      return;
    }

    setCreatedByEmployee({
      name: `${Author?.name ?? ''} ${Author?.surname ?? ''}`.trim(),
      phone_number: Author?.phone_number ?? '',
    });
  };

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
        setGeneratedPdfPath(agenda.generated_pdf_path || null);
        setModifiedAfterGeneration(agenda.modified_after_generation || false);

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
            isEditing: false,
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

  console.log('event', event);

  const getSortedAgendaItems = () => {
    return [...agendaItems].sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return 1;
      if (!b.time) return -1;

      const timeToMinutes = (time: string): number => {
        const [hours, minutes] = time.split(':').map(Number);
        let totalMinutes = hours * 60 + minutes;

        if (hours < 6) {
          totalMinutes += 24 * 60;
        }

        return totalMinutes;
      };

      const aMinutes = timeToMinutes(a.time);
      const bMinutes = timeToMinutes(b.time);

      return aMinutes - bMinutes;
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
              client_contact: contact?.full_name || null,
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
            client_contact: contact?.full_name || null,
          })
          .eq('id', currentAgendaId);

        if (updateError) throw updateError;
      }

      // items - czyścimy isEditing i sortujemy
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

      // Automatyczne generowanie PDF po zapisie (✅ przekazujemy aktualne ID, bez ryzyka "starego" agendaId)
      setTimeout(() => {
        handleGeneratePDF(currentAgendaId);
      }, 500);
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
    }

    setEditMode(false);
  };

  // ✅ stabilna funkcja + możliwość podania agendaId (naprawia generowanie po zapisie / przy stale state)
  const handleGeneratePDF = useCallback(
    async (forcedAgendaId?: string | null) => {
      console.log('[handleGenerateChecklist] deps', {
        event: eventRef.current,
        employee: employeeRef.current,
        organization,
        contact,
      });

      const currentEvent = eventRef.current;
      const currentEmployee = employeeRef.current;
      const currentAgendaId = forcedAgendaId ?? agendaIdRef.current;

      if (!currentEvent) {
        console.error('[handleGenerateChecklist] event is null');
        alert('Brak danych wydarzenia (event = null). Odśwież stronę i spróbuj ponownie.');
        return;
      }

      if (!currentEmployee) {
        console.error('[handleGenerateChecklist] employee is null');
        alert('Brak danych zalogowanego użytkownika (employee = null). Zaloguj się ponownie.');
        return;
      }

      if (!currentAgendaId) {
        alert('Najpierw zapisz agendę');
        return;
      }

      try {
        setGenerating(true);

        // ✅ zawsze bierzemy najnowszy generated_pdf_path z bazy (żeby nie działać na "starym" state)
        const { data: agenda, error: agendaError } = await supabase
          .from('event_agendas')
          .select('generated_pdf_path')
          .eq('id', currentAgendaId)
          .maybeSingle();

        if (agendaError && agendaError.code !== 'PGRST116') {
          throw agendaError;
        }

        const latestPdfPath = agenda?.generated_pdf_path ?? generatedPdfPathRef.current ?? null;

        // 0. Usuń poprzedni PDF jeśli istnieje
        if (latestPdfPath) {
          try {
            await supabase.storage.from('event-files').remove([latestPdfPath]);
            await supabase.from('event_files').delete().eq('file_path', latestPdfPath);
          } catch (deleteError) {
            console.warn('Błąd podczas usuwania poprzedniego PDF:', deleteError);
          }
        }

        const safeText = (v: any) => (v == null ? '' : String(v));

        const clientContact = safeText(organization?.alias ?? organization?.name);
        const contactName = safeText(contact?.full_name ?? (contact as any)?.name);
        const authorName = safeText(createdByEmployeeRef.current?.name ?? createdByEmployee?.name);

        // ✅ SANITY LAYER: wszystko co trafia do HTML ma być stringiem, żeby buildAgendaHtml nie walił nullami
        const safeEventName = String(eventName ?? '');
        const safeContactNumber = String((contact as any)?.business_phone ?? '');
        const authorNumber = String(createdByEmployeeRef.current?.phone_number ?? '');

        // 1. Zbuduj HTML agendy (z ochroną na wypadek błędu wewnątrz buildAgendaHtml)
        let html = '';
        try {
          const payload = {
            eventName: safeEventName,
            eventDate: normalizedEventDate, // YYYY-MM-DD
            startTime: startTimeInput,
            endTime: endTimeInput,
            clientContact: clientContact,
            contactName: contactName,
            contactNumber: safeContactNumber,
            agendaItems: getSortedAgendaItems(),
            agendaNotes,
            lastUpdated: new Date().toISOString(),
            authorName: authorName,
            authorNumber: authorNumber,
          };

          console.log('[Agenda PDF] buildAgendaHtml payload', payload);
          html = buildAgendaHtml(payload);
        } catch (e) {
          console.error('[Agenda PDF] buildAgendaHtml crashed', e);
          alert('Wystąpił błąd podczas budowania HTML agendy (szczegóły w konsoli).');
          return;
        }

        // 2. Dynamiczny import html2pdf.js (działa tylko w przeglądarce)
        const { default: html2pdf } = await import('html2pdf.js');
        const html2pdfFn: any = (html2pdf as any) || html2pdf;

        // 3. Tworzymy tymczasowy element z HTML-em
        const element = document.createElement('div');
        element.innerHTML = html;

        const opt: any = {
          margin: [10, 10, 20, 10], // większy bottom (20 mm)
          filename: `agenda-${safeEventName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`,
          image: { type: 'jpeg' as const, quality: 0.98 },
          html2canvas: { scale: 2 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        };

        // 4. Generujemy PDF jako Blob
        const worker = html2pdfFn().from(element).set(opt).toPdf();
        const pdfBlob: Blob = await worker.output('blob');

        // 5. Zapisz PDF do storage i event_files
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const fileName = `agenda-${safeEventName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${timestamp}.pdf`;
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
          const { data: folderId } = await supabase.rpc('get_or_create_documents_subfolder', {
            p_event_id: eventId,
            p_required_permission: null,
            p_created_by: currentEmployee?.id,
          });

          await supabase.from('event_files').insert([
            {
              event_id: eventId,
              folder_id: folderId,
              name: fileName,
              original_name: fileName,
              file_path: storagePath,
              file_size: pdfBlob.size,
              mime_type: 'application/pdf',
              document_type: 'agenda',
              thumbnail_url: null,
              uploaded_by: currentEmployee?.id,
            },
          ]);

          await supabase
            .from('event_agendas')
            .update({
              generated_pdf_path: storagePath,
              generated_pdf_at: new Date().toISOString(),
              modified_after_generation: false,
            })
            .eq('id', currentAgendaId);

          setGeneratedPdfPath(storagePath);
          setModifiedAfterGeneration(false);

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
    },
    [
      agendaNotes,
      contact,
      endTimeInput,
      eventId,
      eventName,
      normalizedEventDate,
      organization,
      startTimeInput,
      getSortedAgendaItems,
    ],
  );

  const handleShowPdf = async () => {
    if (!generatedPdfPath) return;

    try {
      const { data } = await supabase.storage
        .from('event-files')
        .createSignedUrl(generatedPdfPath, 3600);

      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank');
      }
    } catch (err) {
      console.error('Error showing PDF:', err);
      alert('Błąd podczas otwierania PDF');
    }
  };

  const handleDownloadPdf = async () => {
    if (!generatedPdfPath) return;

    try {
      const { data } = await supabase.storage
        .from('event-files')
        .createSignedUrl(generatedPdfPath, 3600);

      if (data?.signedUrl) {
        const response = await fetch(data.signedUrl);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = generatedPdfPath.split('/').pop() || 'agenda.pdf';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();

        setTimeout(() => {
          document.body.removeChild(link);
          window.URL.revokeObjectURL(blobUrl);
        }, 100);
      }
    } catch (err) {
      console.error('Error downloading PDF:', err);
      alert('Błąd podczas pobierania PDF');
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ((window as any).html2pdf) {
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.9.3/html2pdf.bundle.min.js';
    script.async = true;
    script.onerror = () => console.error('Nie udało się załadować html2pdf.js');
    document.body.appendChild(script);

    return () => {
      // opcjonalnie usuwanie skryptu przy unmount
      document.body.removeChild(script);
    };
  }, []);

  const getNextRoundedTime = (): string => {
    if (agendaItems.length === 0) {
      const now = new Date();
      now.setMinutes(0, 0, 0);
      return now.toTimeString().slice(0, 5);
    }

    const lastItem = agendaItems[agendaItems.length - 1];
    if (!lastItem.time) {
      const now = new Date();
      now.setMinutes(0, 0, 0);
      return now.toTimeString().slice(0, 5);
    }

    const [hours, minutes] = lastItem.time.split(':').map(Number);
    const nextHour = new Date();
    nextHour.setHours(hours + 1, 0, 0, 0);
    return nextHour.toTimeString().slice(0, 5);
  };

  const addAgendaItem = () => {
    const newItem: AgendaItem = {
      time: getNextRoundedTime(),
      title: '',
      description: '',
      order_index: agendaItems.length,
      isEditing: true,
    };

    setAgendaItems([...agendaItems, newItem]);
  };

  const removeAgendaItem = (index: number) => {
    setAgendaItems(agendaItems.filter((_, i) => i !== index));
  };

  const updateAgendaItem = (index: number, field: keyof AgendaItem, value: any) => {
    const updated = [...agendaItems];
    updated[index] = { ...updated[index], [field]: value };
    setAgendaItems(updated);
  };

  const toggleItemEdit = (index: number, editing: boolean) => {
    const updated = [...agendaItems];
    updated[index] = { ...updated[index], isEditing: editing };
    setAgendaItems(updated);
  };

  const handleTimeWheel = (
    e: React.WheelEvent<HTMLInputElement>,
    index: number,
    currentTime: string,
  ) => {
    const target = e.currentTarget;

    if (document.activeElement !== target) {
      return;
    }

    e.preventDefault();

    if (!currentTime || !/^\d{2}:\d{2}$/.test(currentTime)) return;

    const [hours, minutes] = currentTime.split(':').map(Number);
    const rect = target.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const inputWidth = rect.width;
    const isHourSide = clickX < inputWidth / 2;

    let newHours = hours;
    let newMinutes = minutes;

    if (e.deltaY < 0) {
      if (isHourSide) {
        newHours = (hours + 1) % 24;
      } else {
        newMinutes = (minutes + 1) % 60;
      }
    } else {
      if (isHourSide) {
        newHours = (hours - 1 + 24) % 24;
      } else {
        newMinutes = (minutes - 1 + 60) % 60;
      }
    }

    const newTime = `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
    updateAgendaItem(index, 'time', newTime);
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

  const actions = useMemo<Action[]>(() => {
    const result: Action[] = [];

    /** =====================
     * TRYB NIE-EDYCJI AGENDA
     * ===================== */
    if (canManage && !editMode) {
      result.push({
        label: 'Edytuj agendę',
        onClick: () => setEditMode(true),
        icon: <List className="h-4 w-4" />,
        variant: 'default',
      });
    }

    /** =====================
     * TRYB EDYCJI AGENDA
     * ===================== */
    if (canManage && editMode) {
      result.push(
        {
          label: saving ? 'Zapisywanie...' : 'Zapisz',
          onClick: handleSave,
          icon: <Save className="h-4 w-4" />,
          variant: 'primary',
        },
        {
          label: 'Anuluj',
          onClick: handleCancelEdit,
          variant: 'default',
        },
      );

      return result; // ⬅️ w trybie edycji nie pokazujemy reszty akcji
    }

    /** =====================
     * PDF / DRUK (tylko gdy NIE editMode)
     * ===================== */
    if (!editMode && agendaId) {
      if (!generatedPdfPath || modifiedAfterGeneration) {
        result.push({
          label: generating
            ? 'Generowanie...'
            : modifiedAfterGeneration
              ? 'Regeneruj PDF'
              : 'Generuj PDF',
          onClick: () => handleGeneratePDF(),
          icon: <FileDown className="h-4 w-4" />,
          variant: 'default',
        });
      } else {
        result.push(
          {
            label: 'Pokaż PDF',
            onClick: handleShowPdf,
            icon: <Eye className="h-4 w-4" />,
            variant: 'default',
          },
          {
            label: 'Pobierz PDF',
            onClick: handleDownloadPdf,
            icon: <Download className="h-4 w-4" />,
            variant: 'default',
          },
        );
      }

      result.push({
        label: 'Drukuj',
        onClick: () => window.print(),
        icon: <Printer className="h-4 w-4" />,
        variant: 'default',
      });
    }

    return result;
  }, [
    canManage,
    editMode,
    saving,
    agendaId,
    generatedPdfPath,
    modifiedAfterGeneration,
    generating,
    handleGeneratePDF,
  ]);

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
          <ResponsiveActionBar actions={actions} />
        </div>
      </div>
      <div className="space-y-6">
        {/* Podstawowe informacje */}

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
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-[#d3bb73]/20 bg-[#151726] text-xs uppercase text-[#e5e4e2]/60">
                    <tr>
                      <th className="w-32 px-4 py-3">Godzina</th>
                      <th className="w-64 px-4 py-3">Etap</th>
                      <th className="px-4 py-3">Opis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getSortedAgendaItems().map((item, idx) => (
                      <tr
                        key={item.id || `sorted-${idx}`}
                        className="border-b border-[#d3bb73]/10 last:border-0"
                      >
                        <td className="px-4 py-3 align-top text-[#e5e4e2]/80">
                          {item.time || '--:--'}
                        </td>
                        <td className="px-4 py-3 align-top font-medium text-[#e5e4e2]">
                          {item.title || '—'}
                        </td>
                        <td className="whitespace-pre-wrap px-4 py-3 align-top text-[#e5e4e2]/80">
                          {item.description || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* TRYB EDYCJI – karty z indywidualną edycją */}
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
                <>
                  {agendaItems.map((item, originalIndex) => {
                    const isEditing = item.isEditing || false;

                    return (
                      <div
                        key={item.id || `temp-${originalIndex}`}
                        className="flex items-start gap-3 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-4"
                      >
                        <Clock className="mt-1 h-5 w-5 flex-shrink-0 text-[#d3bb73]" />

                        {isEditing ? (
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2">
                              <input
                                type="time"
                                value={item.time}
                                onChange={(e) =>
                                  updateAgendaItem(originalIndex, 'time', e.target.value)
                                }
                                onWheel={(e) => handleTimeWheel(e, originalIndex, item.time)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    toggleItemEdit(originalIndex, false);
                                  }
                                }}
                                className="rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-1 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                              />
                              <input
                                type="text"
                                value={item.title}
                                onChange={(e) =>
                                  updateAgendaItem(originalIndex, 'title', e.target.value)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    toggleItemEdit(originalIndex, false);
                                  }
                                }}
                                placeholder="Tytuł etapu..."
                                className="flex-1 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-1 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                              />
                            </div>
                            <textarea
                              value={item.description}
                              onChange={(e) =>
                                updateAgendaItem(originalIndex, 'description', e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && e.ctrlKey) {
                                  e.preventDefault();
                                  toggleItemEdit(originalIndex, false);
                                }
                              }}
                              placeholder="Opis etapu..."
                              rows={2}
                              className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                            />
                          </div>
                        ) : (
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-[#d3bb73]">
                                {item.time || '--:--'}
                              </span>
                              <span className="text-[#e5e4e2]">{item.title || '(bez tytułu)'}</span>
                            </div>
                            {item.description && (
                              <p className="whitespace-pre-wrap text-sm text-[#e5e4e2]/70">
                                {item.description}
                              </p>
                            )}
                          </div>
                        )}

                        <div className="flex flex-shrink-0 items-center gap-1">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => toggleItemEdit(originalIndex, false)}
                                className="p-2 text-green-400/60 hover:text-green-400"
                                title="Zatwierdź (Enter)"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => removeAgendaItem(originalIndex)}
                                className="p-2 text-red-400/60 hover:text-red-400"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => toggleItemEdit(originalIndex, true)}
                                className="p-2 text-[#d3bb73]/60 hover:text-[#d3bb73]"
                                title="Edytuj"
                              >
                                <Edit3 className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => removeAgendaItem(originalIndex)}
                                className="p-2 text-red-400/60 hover:text-red-400"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  <div className="flex justify-center pt-2">
                    <button
                      onClick={() => addAgendaItem()}
                      className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 px-4 py-2 text-[#d3bb73]/80 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Dodaj kolejny etap</span>
                    </button>
                  </div>
                </>
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
                <div className="py-4 text-center text-[#e5e4e2]/60">Brak uwag do agendy.</div>
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
