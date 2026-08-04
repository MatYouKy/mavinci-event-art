import { View, Text, StyleSheet, TouchableOpacity, Alert, Modal, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { colors, spacing } from '../../../theme';
import { supabase } from '../../../lib/supabase';
import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../../navigation/RootNavigator';
import { WebView } from 'react-native-webview';

export interface AgendaItem {
  id: string;
  time: string | null;
  title: string;
  description: string | null;
  order_index: number;
}

export interface AgendaNote {
  id: string;
  content: string;
  order_index: number;
  level: number;
  parent_id: string | null;
}

export interface AgendaData {
  id: string;
  event_name: string;
  start_time: string | null;
  end_time: string | null;
  client_contact: string | null;
  generated_pdf_path: string | null;
  items: AgendaItem[];
  notes: AgendaNote[];
}

export function AgendaTab({ agenda }: { agenda: AgendaData | null }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  if (!agenda || agenda.items.length === 0) {
    return (
      <View style={styles.emptyTab}>
        <Feather name="clock" size={40} color={colors.text.tertiary} />
        <Text style={styles.emptyTabText}>Brak pozycji w agendzie</Text>
      </View>
    );
  }

  const formatTime = (time: string | null) => {
    if (!time) return '';

    const date = new Date(time);

    return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(
      2,
      '0',
    )}`;
  };

  const handleOpenPdf = async () => {
    if (!agenda.generated_pdf_path) return;

    try {
      const { data, error } = await supabase.storage
        .from('event-files')
        .createSignedUrl(agenda.generated_pdf_path, 3600);

      if (error || !data?.signedUrl) {
        throw new Error();
      }

      navigation.navigate('PdfViewer', {
        url: data.signedUrl,
      });
    } catch (err) {
      Alert.alert('Błąd', 'Nie udało się otworzyć PDF agendy');
    }
  };

  return (
    <>
      <View style={styles.agendaContainer}>
        {agenda.generated_pdf_path && (
          <TouchableOpacity style={styles.pdfButton} onPress={handleOpenPdf} activeOpacity={0.7}>
            <Feather name="file-text" size={16} color={colors.primary.gold} />

            <Text style={styles.pdfButtonText}>Pokaż PDF agendy</Text>

            <Feather name="external-link" size={14} color={colors.primary.gold} />
          </TouchableOpacity>
        )}

        {(agenda.start_time || agenda.end_time) && (
          <View style={styles.agendaHeaderInfo}>
            <Feather name="clock" size={12} color={colors.text.tertiary} />

            <Text style={styles.agendaHeaderText}>
              {formatTime(agenda.start_time)}

              {agenda.end_time ? ` - ${formatTime(agenda.end_time)}` : ''}
            </Text>
          </View>
        )}

        {agenda.items.map((item, idx) => (
          <View key={item.id} style={styles.agendaItem}>
            <View style={styles.agendaTimeline}>
              <View style={styles.agendaDot} />

              {idx < agenda.items.length - 1 && <View style={styles.agendaLine} />}
            </View>

            <View style={styles.agendaContent}>
              {item.time && <Text style={styles.agendaTime}>{formatTime(item.time)}</Text>}

              <Text style={styles.agendaTitle}>{item.title}</Text>

              {item.description && <Text style={styles.agendaDesc}>{item.description}</Text>}
            </View>
          </View>
        ))}

        {agenda.notes.length > 0 && (
          <View style={styles.agendaNotesSection}>
            <Text style={styles.agendaNotesSectionTitle}>Uwagi</Text>

            {agenda.notes
              .filter((n) => !n.parent_id)
              .map((note) => (
                <View
                  key={note.id}
                  style={[
                    styles.agendaNoteRow,
                    {
                      marginLeft: note.level * 16,
                    },
                  ]}
                >
                  <View style={styles.agendaNoteBullet} />

                  <Text style={styles.agendaNoteText}>{note.content}</Text>
                </View>
              ))}

            {agenda.notes
              .filter((n) => n.parent_id)
              .map((note) => (
                <View
                  key={note.id}
                  style={[
                    styles.agendaNoteRow,
                    {
                      marginLeft: (note.level + 1) * 16,
                    },
                  ]}
                >
                  <View style={[styles.agendaNoteBullet, styles.agendaNoteBulletSub]} />

                  <Text style={styles.agendaNoteTextSub}>{note.content}</Text>
                </View>
              ))}
          </View>
        )}
      </View>

      <Modal visible={!!pdfUrl} animationType="slide" onRequestClose={() => setPdfUrl(null)}>
        <View style={styles.pdfModal}>
          <View style={styles.pdfHeader}>
            <Text style={styles.pdfTitle}>Agenda PDF</Text>

            <TouchableOpacity onPress={() => setPdfUrl(null)}>
              <Feather name="x" size={26} color={colors.text.primary} />
            </TouchableOpacity>
          </View>

          {pdfUrl && (
            <WebView
              source={{
                uri: pdfUrl,
              }}
              style={styles.pdfViewer}
              originWhitelist={['*']}
              startInLoadingState
            />
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  emptyTab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyTabText: { fontSize: 14, color: colors.text.tertiary },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    gap: 10,
  },

  agendaContainer: { padding: spacing.md },
  agendaHeaderInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.background.tertiary,
    borderRadius: 8,
  },
  agendaHeaderText: { fontSize: 12, color: colors.text.secondary },
  agendaItem: { flexDirection: 'row', marginBottom: 0 },
  agendaTimeline: { width: 24, alignItems: 'center' },
  agendaDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary.gold,
    marginTop: 4,
  },
  agendaLine: {
    width: 2,
    flex: 1,
    backgroundColor: colors.primary.gold + '30',
    marginTop: 4,
  },
  agendaContent: {
    flex: 1,
    paddingLeft: 12,
    paddingBottom: 20,
  },
  agendaTime: { fontSize: 11, color: colors.primary.gold, fontWeight: '700', marginBottom: 2 },
  agendaTitle: { fontSize: 14, color: colors.text.primary, fontWeight: '600' },
  agendaDesc: { fontSize: 12, color: colors.text.secondary, marginTop: 2, lineHeight: 18 },
  agendaNotesSection: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
  },
  agendaNotesSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text.secondary,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  agendaNoteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  agendaNoteBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary.gold,
    marginTop: 5,
  },
  agendaNoteBulletSub: {
    backgroundColor: colors.text.tertiary,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  agendaNoteText: { flex: 1, fontSize: 13, color: colors.text.primary, lineHeight: 18 },
  agendaNoteTextSub: { flex: 1, fontSize: 12, color: colors.text.secondary, lineHeight: 17 },
  pdfButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary.gold + '15',
    borderWidth: 1,
    borderColor: colors.primary.gold + '40',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  pdfButtonText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.primary.gold },
  pdfModal: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },

  pdfHeader: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background.secondary,
  },

  pdfTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text.primary,
  },

  pdfViewer: {
    flex: 1,
    width: Dimensions.get('window').width,
  },
});
