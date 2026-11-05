import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
  Modal,
  Pressable,
  Dimensions,
} from 'react-native';

import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../../../theme';
import { supabase } from '../../../lib/supabase';
import EquipmentChecklistPanel from '../EquipmentChecklist/EquipmentChecklistPanel';

export interface ChecklistItem {
  id: string;
  item_name: string;
  quantity: number | null;
  loaded: boolean;
  unloaded: boolean;
  priority: string | null;
  vehicle_name: string | null;
  notes: string | null;
  sort_order: number;
}

export interface EventEquipmentItem {
  id: string;
  equipment_name: string;
  quantity: number;
  status: string | null;
  kit_name: string | null;
  category_name: string | null;
  thumbnail_url: string | null;
  is_loaded: boolean;
}

export interface LogisticsItem {
  id: string;
  title: string;
  description: string | null;
  activity_type: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
  responsible_employee: { name: string; surname: string } | null;
  sort_order: number;
}

/*
 * Zakładka „Checklista”: sprzęt w trzech etapach (EquipmentChecklistPanel — wydanie, załadunek powrotny, zwrot; RPC
 * z docs/equipment-checklist.md), notatki do checklisty, PDF listy, lista załadunku i harmonogram logistyczny.
 * Potwierdzenie wydania, prośba o odblokowanie i cofnięcie etapu idą wyłącznie przez RPC checklisty — pól wydania
 * w `events` nie zmienia się bezpośrednim zapisem (strażnik a_guard_event_loading_fields).
 */
export function ChecklistTab({
  eventId,
  checklist,
  equipment,
  logistics,
  pdfPath,
  onToggle,
  event,
  onEquipmentChanged,
  refreshKey,
}: {
  eventId: string;
  checklist: ChecklistItem[];
  /** Dawna lista sprzętu — tylko do odczytu, gdy baza nie ma jeszcze checklisty w trzech etapach. */
  equipment: EventEquipmentItem[];
  logistics: LogisticsItem[];
  pdfPath: string | null;
  onToggle: (item: ChecklistItem) => void;
  event: any;
  /** Po potwierdzeniu / cofnięciu etapu checklisty sprzętu (kroki realizacji, dane wydarzenia). */
  onEquipmentChanged?: () => void;
  /** Odświeżenie ekranu („pociągnij w dół”) wczytuje ponownie checklistę sprzętu. */
  refreshKey?: number;
}) {
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfTitle, setPdfTitle] = useState<string>('Checklist PDF');

  const loadedCount = checklist.filter((i) => i.loaded).length;
  const equipmentLoadedCount = equipment.filter((i) => i.is_loaded).length;
  const isLoadingConfirmed = Boolean(event?.loading_confirmed);

  const handleOpenPdf = async () => {
    if (!pdfPath) return;
  
    try {
      const { data, error } = await supabase.storage
        .from('event-files')
        .createSignedUrl(pdfPath, 3600);
  
      if (error || !data?.signedUrl) {
        throw new Error();
      }
  
      setPdfTitle('Checklista załadunku');
      setPdfUrl(data.signedUrl);
  
    } catch (err) {
      Alert.alert(
        'Błąd',
        'Nie udało się otworzyć PDF checklisty'
      );
    }
  };

  const groupedEquipment = equipment.reduce(
    (acc, item) => {
      const cat = item.category_name || 'Inne';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    },
    {} as Record<string, EventEquipmentItem[]>,
  );

  const PRIORITY_COLORS: Record<string, string> = {
    high: colors.status.error,
    medium: colors.status.warning,
    low: colors.status.info,
  };

  const ACTIVITY_LABELS: Record<string, string> = {
    loading: 'Załadunek',
    unloading: 'Rozładunek',
    setup: 'Montaż',
    rehearsal: 'Próba',
    event: 'Wydarzenie',
    breakdown: 'Demontaż',
    packing: 'Pakowanie',
  };

  const STATUS_ICONS: Record<string, { icon: string; color: string }> = {
    pending: { icon: 'circle', color: colors.text.tertiary },
    in_progress: { icon: 'play-circle', color: colors.status.info },
    completed: { icon: 'check-circle', color: colors.status.success },
    delayed: { icon: 'alert-circle', color: colors.status.warning },
    cancelled: { icon: 'x-circle', color: colors.status.error },
  };

  return (
    <View style={styles.checklistContainer}>
      {event?.equipment_checklist_notes?.trim() ? (
        <View style={{ padding: spacing.md, marginBottom: spacing.md, borderRadius: 12, backgroundColor: colors.background.secondary }}>
          <Text style={{ color: colors.primary.gold, fontWeight: '600', marginBottom: 8 }}>Notatki do checklisty</Text>
          <Text selectable style={{ color: colors.text.primary, lineHeight: 22 }}>{event.equipment_checklist_notes}</Text>
        </View>
      ) : null}
      {pdfPath && (
        <TouchableOpacity style={styles.pdfButton} onPress={handleOpenPdf} activeOpacity={0.7}>
          <Feather name="file-text" size={16} color={colors.primary.gold} />
          <Text style={styles.pdfButtonText}>Pokaż PDF</Text>
          <Feather name="external-link" size={14} color={colors.primary.gold} />
        </TouchableOpacity>
      )}

      {/* Sprzęt: wydanie → załadunek powrotny → zwrot (stan, uprawnienia i blokady liczy baza) */}
      <View style={styles.checklistSection}>
        <EquipmentChecklistPanel
          eventId={eventId}
          onChanged={onEquipmentChanged}
          refreshKey={refreshKey}
          legacy={
            <>
              {isLoadingConfirmed && (
                <View style={styles.legacyConfirmed}>
                  <Text style={styles.legacyConfirmedTitle}>
                    Załadunek potwierdzony
                    {event?.loading_confirmed_at ? ` · ${new Date(event.loading_confirmed_at).toLocaleString('pl-PL')}` : ''}
                  </Text>
                  {!!event?.loading_notes && <Text style={styles.legacyConfirmedNotes}>Uwagi: {event.loading_notes}</Text>}
                </View>
              )}
              {equipment.length > 0 && (
                <View style={styles.checklistSection}>
                  <Text style={styles.checklistSectionTitle}>
                    Sprzęt ({equipmentLoadedCount}/{equipment.length} załadowano)
                  </Text>
                  {Object.entries(groupedEquipment).map(([category, items]) => (
                    <View key={category}>
                      <Text style={styles.equipmentCategoryLabel}>{category}</Text>
                      {items.map((item) => {
                        const isLoaded = item.is_loaded;
                        return (
                          <View key={item.id} style={styles.equipmentChecklistRow}>
                            <TouchableOpacity
                              style={styles.equipmentThumbnailWrap}
                              onPress={() => item.thumbnail_url && setPreviewImage(item.thumbnail_url)}
                              activeOpacity={item.thumbnail_url ? 0.7 : 1}
                            >
                              {item.thumbnail_url ? (
                                <Image
                                  source={{ uri: item.thumbnail_url }}
                                  style={styles.equipmentThumbnail}
                                  resizeMode="cover"
                                />
                              ) : (
                                <View style={styles.equipmentThumbnailPlaceholder}>
                                  <Feather name="package" size={18} color={colors.text.tertiary} />
                                </View>
                              )}
                            </TouchableOpacity>
                            <View style={styles.equipmentChecklistContent}>
                              <View style={styles.equipmentChecklistInfo}>
                                <Text
                                  style={[
                                    styles.checklistItemTitle,
                                    isLoaded && styles.checklistItemTitleDone,
                                  ]}
                                  numberOfLines={2}
                                >
                                  {item.equipment_name}
                                </Text>
                                <View style={styles.checklistItemMeta}>
                                  {item.quantity > 1 && (
                                    <Text style={styles.checklistMetaText}>x{item.quantity}</Text>
                                  )}
                                  {item.kit_name && (
                                    <View
                                      style={[
                                        styles.priorityBadge,
                                        { backgroundColor: colors.primary.gold + '20' },
                                      ]}
                                    >
                                      <Text style={[styles.priorityText, { color: colors.primary.gold }]}>
                                        Kit
                                      </Text>
                                    </View>
                                  )}
                                  {item.status && (
                                    <Text style={styles.checklistMetaText}>{item.status}</Text>
                                  )}
                                </View>
                              </View>
                              <View style={[styles.checkbox, isLoaded && styles.checkboxChecked]}>
                                {isLoaded && <Feather name="check" size={12} color={colors.white} />}
                              </View>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
              )}
            </>
          }
        />
      </View>

      {/* PDF Preview */}
      <Modal visible={!!pdfUrl} animationType="slide" onRequestClose={() => setPdfUrl(null)}>
        <View style={styles.pdfModal}>
          <View style={styles.pdfHeader}>
            <Text style={styles.pdfTitle} numberOfLines={1}>
              {pdfTitle}
            </Text>

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
              startInLoadingState
            />
          )}
        </View>
      </Modal>
      {/* Image preview modal */}
      <Modal
        visible={!!previewImage}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewImage(null)}
      >
        <Pressable style={styles.imagePreviewOverlay} onPress={() => setPreviewImage(null)}>
          <View style={styles.imagePreviewContainer}>
            {previewImage && (
              <Image
                source={{ uri: previewImage }}
                style={styles.imagePreviewFull}
                resizeMode="contain"
              />
            )}
            <TouchableOpacity
              style={styles.imagePreviewClose}
              onPress={() => setPreviewImage(null)}
            >
              <Feather name="x" size={24} color={colors.white} />
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Loading checklist */}
      {checklist.length > 0 && (
        <View style={styles.checklistSection}>
          <Text style={styles.checklistSectionTitle}>
            Załadunek / Rozładunek ({loadedCount}/{checklist.length})
          </Text>
          {checklist.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.checklistItem}
              onPress={() => onToggle(item)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, item.loaded && styles.checkboxChecked]}>
                {item.loaded && <Feather name="check" size={12} color={colors.white} />}
              </View>
              <View style={styles.checklistItemContent}>
                <View style={styles.checklistItemHeader}>
                  <Text
                    style={[
                      styles.checklistItemTitle,
                      item.loaded && styles.checklistItemTitleDone,
                    ]}
                    numberOfLines={1}
                  >
                    {item.item_name}
                  </Text>
                  {item.priority && (
                    <View
                      style={[
                        styles.priorityBadge,
                        {
                          backgroundColor:
                            (PRIORITY_COLORS[item.priority] || colors.text.tertiary) + '20',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.priorityText,
                          { color: PRIORITY_COLORS[item.priority] || colors.text.tertiary },
                        ]}
                      >
                        {item.priority}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.checklistItemMeta}>
                  {item.quantity && item.quantity > 1 && (
                    <Text style={styles.checklistMetaText}>x{item.quantity}</Text>
                  )}
                  {item.vehicle_name && (
                    <Text style={styles.checklistMetaText}>
                      <Feather name="truck" size={10} color={colors.text.tertiary} />{' '}
                      {item.vehicle_name}
                    </Text>
                  )}
                </View>
                {!!item.notes?.trim() && <Text selectable style={{ color: colors.text.secondary, marginTop: 8, lineHeight: 20 }}>{item.notes}</Text>}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Logistics timeline */}
      {logistics.length > 0 && (
        <View style={styles.checklistSection}>
          <Text style={styles.checklistSectionTitle}>Harmonogram logistyczny</Text>
          {logistics.map((item) => {
            const statusInfo = STATUS_ICONS[item.status || 'pending'] || STATUS_ICONS.pending;
            return (
              <View key={item.id} style={styles.logisticsItem}>
                <View style={styles.logisticsIconContainer}>
                  <Feather name={statusInfo.icon as any} size={18} color={statusInfo.color} />
                </View>
                <View style={styles.logisticsContent}>
                  <View style={styles.logisticsHeader}>
                    <Text style={styles.logisticsTitle}>{item.title}</Text>
                    {item.activity_type && (
                      <Text style={styles.logisticsType}>
                        {ACTIVITY_LABELS[item.activity_type] || item.activity_type}
                      </Text>
                    )}
                  </View>
                  {item.description && item.description !== item.title && (
                    <Text style={styles.logisticsDesc}>{item.description}</Text>
                  )}
                  <View style={styles.logisticsMetaRow}>
                    {item.start_time && (
                      <Text style={styles.logisticsTime}>
                        {new Date(item.start_time).toLocaleTimeString('pl-PL', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {item.end_time &&
                          ` - ${new Date(item.end_time).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`}
                      </Text>
                    )}
                    {item.responsible_employee && (
                      <Text style={styles.logisticsPerson}>
                        {item.responsible_employee.name} {item.responsible_employee.surname}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  legacyConfirmed: {
    backgroundColor: 'rgba(5, 150, 105, 0.12)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    gap: 4,
  },
  legacyConfirmedTitle: { color: '#34d399', fontSize: 13, fontWeight: '600' },
  legacyConfirmedNotes: { color: '#fbbf24', fontSize: 12 },
  emptyTab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyTabText: { fontSize: 14, color: colors.text.tertiary },
  checklistProgress: { marginBottom: 16 },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.background.tertiary,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.status.success,
  },
  progressText: { fontSize: 11, color: colors.text.tertiary, textAlign: 'right' },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    gap: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.text.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.status.success,
    borderColor: colors.status.success,
  },
  checklistItemContent: { flex: 1 },
  checklistItemHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checklistItemTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: 13, color: colors.text.primary, fontWeight: '500', flex: 1 },
  checklistItemTitleDone: {
    textDecorationLine: 'line-through',
    color: colors.text.tertiary,
  },
  checklistItemMeta: { flexDirection: 'row', gap: 10, marginTop: 2 },
  checklistMetaText: { fontSize: 11, color: colors.text.tertiary },
  checklistContainer: { padding: spacing.md },
  checklistSection: { marginBottom: 20 },
  checklistSectionTitle: {
    fontFamily: 'MBFAtom',
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  pdfButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary.gold + '1f',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  pdfButtonText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.primary.gold },
  equipmentCategoryLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 10,
    marginBottom: 4,
    paddingLeft: 4,
  },
  equipmentChecklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 10,
  },
  equipmentThumbnailWrap: {
    width: 44,
    height: 44,
    borderRadius: 8,
    overflow: 'hidden',
  },
  equipmentThumbnail: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  equipmentThumbnailPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  equipmentChecklistContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  equipmentChecklistInfo: {
    flex: 1,
    gap: 2,
  },
  imagePreviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePreviewContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePreviewFull: {
    width: Dimensions.get('window').width - 32,
    height: Dimensions.get('window').height * 0.7,
  },
  imagePreviewClose: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  priorityBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  priorityText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  // Logistics
  logisticsItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    gap: 10,
  },
  logisticsIconContainer: { width: 28, alignItems: 'center', paddingTop: 2 },
  logisticsContent: { flex: 1 },
  logisticsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logisticsTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: 13, color: colors.text.primary, fontWeight: '600', flex: 1 },
  logisticsType: {
    fontSize: 10,
    color: colors.text.tertiary,
    backgroundColor: colors.background.tertiary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  logisticsDesc: { fontSize: 12, color: colors.text.secondary, marginTop: 2 },
  logisticsMetaRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  logisticsTime: { fontSize: 11, color: colors.primary.gold, fontWeight: '600' },
  logisticsPerson: { fontSize: 11, color: colors.text.tertiary },
  pdfModal: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },

  pdfHeader: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    backgroundColor: colors.background.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },

  pdfTitle: {

    fontFamily: 'MBFAtom',
    textTransform: 'uppercase',
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.primary,
    marginRight: 12,
  },

  pdfViewer: {
    flex: 1,
  },
});
