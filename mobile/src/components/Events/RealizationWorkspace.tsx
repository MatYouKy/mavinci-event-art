import { AgendaTab } from './EventDetailScreen/AgendaTab';
import RealizationActions from './RealizationActions';
import { TeamTab } from './EventDetailScreen/TeamTab';
import { mergeEventTeam } from '../../lib/eventTeam';
import { useAuth } from '../../contexts/AuthContext';
import { useForegroundEffect } from '../../hooks/useForegroundEffect';
import { useIsFocused } from '@react-navigation/native';
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { supabase } from '../../lib/supabase';
import { colors } from '../../theme';
import { OPERATIONAL_LABELS } from '../../lib/operationalStages';
const date = (s: any) => (s ? new Date(s).toLocaleString('pl-PL') : 'Termin nieustalony');
export default function RealizationWorkspace({
  initialData,
  onBack,
  initialTab,
}: {
  initialData: any;
  onBack: () => void;
  initialTab?: string;
}) {
  const { employee } = useAuth();
  const focused = useIsFocused();
  const initialSection =
    initialTab === 'fleet'
      ? 'logistics'
      : initialTab === 'team'
        ? 'team'
        : initialTab === 'files'
          ? 'files'
          : 'overview';
  const [data, setData] = useState(initialData),
    [error, setError] = useState(''),
    [tab, setTab] = useState(initialSection);
  useEffect(() => setTab(initialSection), [initialSection, initialData.id]);
  const [responsibilityTeam, setResponsibilityTeam] = useState<any[]>([]);
  const team = mergeEventTeam(data.team || [], responsibilityTeam);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const [workspace, members] = await Promise.all([
        supabase.rpc('get_realization_workspace', { p_event_id: initialData.id }),
        supabase.rpc('get_event_responsibility_team', { p_event_id: initialData.id }),
      ]);
      if (signal?.aborted) return;
      if (workspace.error || members.error) {
        setError('Nie udało się odświeżyć realizacji lub pełnego zespołu. Spróbuj ponownie.');
        return;
      }
      if (!workspace.data) {
        onBack();
        return;
      }
      setData(workspace.data);
      setResponsibilityTeam(members.data || []);
      setError('');
    },
    [initialData.id, onBack],
  );
  useForegroundEffect(
    (signal) => {
      if (!focused) return;
      void refresh(signal);
      const timer = setInterval(() => void refresh(signal), 60000);
      return () => clearInterval(timer);
    },
    [refresh, focused],
  );
  const openFile = async (f: any) => {
    let url = f.url;
    if (!url && f.path) {
      const r = await supabase.storage.from('event-files').createSignedUrl(f.path, 300);
      if (r.error) {
        setError('Nie udało się otworzyć pliku.');
        return;
      }
      url = r.data.signedUrl;
    }
    if (url && /^https?:\/\//i.test(url))
      await Linking.openURL(url).catch(() => setError('Nie udało się otworzyć pliku.'));
  };
  const card = (key: string, title: string, body: string) => (
    <View
      key={key}
      style={{
        backgroundColor: colors.background.secondary,
        padding: 14,
        borderRadius: 10,
        marginBottom: 10,
      }}
    >
      <Text style={{ color: colors.primary.gold, fontWeight: '600' }}>{title}</Text>
      <Text style={{ color: colors.text.primary, marginTop: 8 }}>{body}</Text>
    </View>
  );
  const button = (label: string, fn: () => void) => (
    <TouchableOpacity
      onPress={fn}
      style={{ backgroundColor: colors.primary.gold, padding: 12, borderRadius: 8, marginTop: 10 }}
    >
      <Text style={{ color: colors.background.primary }}>{label}</Text>
    </TouchableOpacity>
  );
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background.primary }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
    >
      <TouchableOpacity onPress={onBack}>
        <Text style={{ color: colors.primary.gold }}>← Wydarzenia</Text>
      </TouchableOpacity>
      <Text style={{ fontSize: 22, color: colors.text.primary, marginVertical: 16 }}>
        {data.name}
      </Text>
      {card(
        'status',
        OPERATIONAL_LABELS[data.status] || 'Realizacja',
        `Kierownik: ${data.realization?.manager_name || 'Nie wyznaczono'}${data.realization?.started_at ? '\nPrzejęto: ' + date(data.realization.started_at) : ''}${data.realization?.completed_at ? '\nZrealizowano: ' + date(data.realization.completed_at) : ''}${data.realization?.completion_notes ? '\nUwagi: ' + data.realization.completion_notes : ''}`,
      )}
      <RealizationActions eventId={data.id} onChanged={() => void refresh()} />
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: '#ff9999', marginVertical: 10 }}>
          {error}
        </Text>
      )}
      {!!error && button('Odśwież dane', () => void refresh())}
      <ScrollView horizontal style={{ marginVertical: 16 }}>
        {Object.entries({
          overview: 'Przegląd',
          phases: 'Timeline',
          equipment: 'Sprzęt',
          agenda: 'Agenda',
          team: 'Zespół',
          logistics: 'Logistyka',
          subcontractors: 'Podwykonawcy',
          files: 'Pliki',
        }).map(([key, label]) => (
          <TouchableOpacity
            key={key}
            onPress={() => setTab(key)}
            style={{
              padding: 10,
              borderBottomWidth: tab === key ? 2 : 0,
              borderBottomColor: colors.primary.gold,
            }}
          >
            <Text style={{ color: tab === key ? colors.primary.gold : colors.text.secondary }}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {tab === 'overview' && (
        <>
          {card(
            'scope',
            'Zakres realizacji',
            `${date(data.event_date)} – ${date(data.event_end_date)}\n${data.description || 'Brak opisu'}`,
          )}
          {card(
            'location',
            data.location?.name || 'Lokalizacja',
            [
              data.location?.address,
              data.location?.city,
              data.location?.notes,
              data.location?.technical_details?.description,
              data.location?.technical_details?.restrictions,
              data.location?.technical_details?.difficulties,
              data.location?.contact_name,
              data.location?.phone,
            ]
              .filter(Boolean)
              .join('\n'),
          )}
          {card(
            'contact',
            'Kontakt',
            [data.contact?.name, data.contact?.phone, data.contact?.email]
              .filter(Boolean)
              .join('\n'),
          )}
          {(data.location?.rooms || [])
            .filter((r: any) => data.location?.selected_rooms?.includes(r.id))
            .map((r: any) =>
              card(
                r.id,
                r.name,
                [
                  r.id === data.location.stage_room_id ? 'Scena / DJ' : '',
                  r.notes,
                  r.technical?.description,
                  r.technical?.restrictions,
                  r.technical?.difficulties,
                ]
                  .filter(Boolean)
                  .join('\n'),
              ),
            )}
        </>
      )}
      {tab === 'phases' &&
        (data.phases || []).map((p: any) =>
          card(p.id, p.name, `${date(p.start)} – ${date(p.end)}\n${p.description || ''}`),
        )}
      {['phases', 'equipment', 'logistics', 'subcontractors', 'files'].includes(tab) &&
        !(data[tab === 'logistics' ? 'vehicles' : tab] || []).length && (
          <Text style={{ color: colors.text.secondary, padding: 16 }}>
            Nie dodano jeszcze danych w tej sekcji.
          </Text>
        )}
      {tab === 'equipment' &&
        (data.equipment || []).map((item: any) =>
          card(
            item.id,
            item.name,
            `Ilość: ${item.quantity}\n${item.loaded ? 'Załadowane' : 'Do załadunku'}\n${item.notes || ''}`,
          ),
        )}
      {tab === 'agenda' && (
        <AgendaTab
          agenda={{
            id: data.id,
            event_name: data.name,
            start_time: null,
            end_time: null,
            client_contact: null,
            generated_pdf_path: null,
            items: (data.agenda || []).map((item: any, order_index: number) => ({
              ...item,
              order_index,
            })),
            notes: (data.agenda_notes || []).map((item: any, order_index: number) => ({
              ...item,
              order_index,
              level: 0,
              parent_id: null,
            })),
          }}
        />
      )}
      {tab === 'team' && <TeamTab employees={team} currentEmployeeId={employee?.id || null} />}
      {tab === 'logistics' &&
        (data.vehicles || []).map((v: any) =>
          card(
            v.id,
            v.name || 'Pojazd',
            `Kierowca: ${v.driver || 'Nieprzypisany'}\nWyjazd: ${date(v.departure)}\nPrzyjazd: ${date(v.arrival)}\nPowrót: ${date(v.return)}\n${v.origin || ''}\n${v.notes || ''}`,
          ),
        )}
      {tab === 'subcontractors' &&
        (data.subcontractors || []).map((s: any) =>
          card(
            s.id,
            s.name,
            [
              s.contact_name,
              s.phone,
              s.email,
              s.scope,
              s.deliverables,
              s.guidelines,
              s.notes,
              `${date(s.start)} – ${date(s.end)}`,
            ]
              .filter(Boolean)
              .join('\n'),
          ),
        )}
      {tab === 'files' &&
        (data.files || []).map((f: any) => (
          <TouchableOpacity key={f.id} onPress={() => void openFile(f)}>
            {card(f.id, f.name || 'Plik', 'Otwórz plik')}
          </TouchableOpacity>
        ))}
    </ScrollView>
  );
}
