import React, { useState, useEffect, useCallback } from 'react';
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
  TextInput,
} from 'react-native';

import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../../../theme';
import { supabase } from '../../../lib/supabase';

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

export function ChecklistTab({
  checklist,
  equipment,
  loadedEquipmentIds,
  logistics,
  pdfPath,
  onToggle,
  onToggleEquipment,
  event,
  employee,
  onRefreshEvent,
}: {
  checklist: ChecklistItem[];
  equipment: EventEquipmentItem[];
  loadedEquipmentIds: Set<string>;
  logistics: LogisticsItem[];
  pdfPath: string | null;
  onToggle: (item: ChecklistItem) => void;
  onToggleEquipment: (item: EventEquipmentItem) => void;
  event: any;
  employee: any;
  onRefreshEvent: () => void;
}) {
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfTitle, setPdfTitle] = useState<string>('Checklist PDF');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState('');
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlockReason, setUnlockReason] = useState('');

  const totalItems = checklist.length + equipment.length + logistics.length;
  const loadedCount = checklist.filter((i) => i.loaded).length;
  const equipmentLoadedCount = equipment.filter((i) => loadedEquipmentIds.has(i.id)).length;
  const completedLogistics = logistics.filter((i) => i.status === 'completed').length;
  const totalCompleted = loadedCount + equipmentLoadedCount + completedLogistics;
  const allLoaded = totalItems > 0 && totalCompleted === totalItems;

  const isLoadingConfirmed = Boolean(event?.loading_confirmed);
  const isLoadingLocked = Boolean(event?.loading_locked);
  const isAdmin = employee?.permissions?.includes('admin') || employee?.role === 'admin';

  const handleConfirmLoading = async () => {
    if (!event?.id || !employee?.id) return;
    if (!allLoaded && !loadingNotes.trim()) {
      Alert.alert('Uwaga', 'Wpisz uwagi dlaczego sprzęt nie jest kompletny');
      return;
    }
    const { error } = await supabase
      .from('events')
      .update({
        loading_confirmed: true,
        loading_confirmed_at: new Date().toISOString(),
        loading_confirmed_by: employee.id,
        loading_notes: loadingNotes.trim() || null,
        loading_locked: true,
      })
      .eq('id', event.id);
    if (error) {
      Alert.alert('Błąd', 'Nie udało się potwierdzić załadunku');
      return;
    }
    setShowConfirmModal(false);
    setLoadingNotes('');
    Alert.alert('Sukces', 'Załadunek potwierdzony');
    onRefreshEvent();
  };

  const handleRequestUnlock = async () => {
    if (!event?.id || !employee?.id || !unlockReason.trim()) {
      Alert.alert('Uwaga', 'Wpisz powód prośby o odblokowanie');
      return;
    }
    const { error } = await supabase
      .from('events')
      .update({
        loading_unlock_requested: true,
        loading_unlock_requested_at: new Date().toISOString(),
        loading_unlock_requested_by: employee.id,
        loading_unlock_reason: unlockReason.trim(),
      })
      .eq('id', event.id);
    if (error) {
      Alert.alert('Błąd', 'Nie udało się wysłać prośby');
      return;
    }
    setShowUnlockModal(false);
    setUnlockReason('');
    Alert.alert('Sukces', 'Prośba o odblokowanie wysłana do administratora');
    onRefreshEvent();
  };

  const handleAdminUnlock = () => {
    Alert.alert('Odblokuj checklistę', 'Czy na pewno chcesz odblokować checklistę załadunku?', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Odblokuj',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase
            .from('events')
            .update({
              loading_confirmed: false,
              loading_locked: false,
              loading_unlock_requested: false,
              loading_unlock_reason: null,
              loading_unlock_requested_at: null,
              loading_unlock_requested_by: null,
              loading_notes: null,
              loading_confirmed_at: null,
              loading_confirmed_by: null,
            })
            .eq('id', event.id);
          if (!error) {
            Alert.alert('Sukces', 'Checklista odblokowana');
            onRefreshEvent();
          }
        },
      },
    ]);
  };

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

  if (totalItems === 0) {
    return (
      <View style={styles.emptyTab}>
        <Feather name="check-square" size={40} color={colors.text.tertiary} />
        <Text style={styles.emptyTabText}>Brak pozycji na checkliście</Text>
      </View>
    );
  }

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
      {/* PDF button + Confirm loading button */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        {pdfPath && (
          <TouchableOpacity
            style={[styles.pdfButton, { flex: 1, marginBottom: 0 }]}
            onPress={handleOpenPdf}
            activeOpacity={0.7}
          >
            <Feather name="file-text" size={16} color={colors.primary.gold} />
            <Text style={styles.pdfButtonText}>Pokaż PDF</Text>
            <Feather name="external-link" size={14} color={colors.primary.gold} />
          </TouchableOpacity>
        )}

        {!isLoadingConfirmed && totalItems > 0 && (
          <TouchableOpacity
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 8,
              backgroundColor: '#059669',
            }}
            onPress={() => setShowConfirmModal(true)}
            activeOpacity={0.7}
          >
            <Feather name="check-circle" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Załadowany</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Loading confirmed banner */}
      {isLoadingConfirmed && (
        <View
          style={{
            backgroundColor: 'rgba(5, 150, 105, 0.1)',
            borderWidth: 1,
            borderColor: 'rgba(5, 150, 105, 0.3)',
            borderRadius: 10,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: 'rgba(5, 150, 105, 0.2)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Feather name="check" size={14} color="#34d399" />
              </View>
              <View>
                <Text style={{ color: '#34d399', fontSize: 13, fontWeight: '600' }}>
                  Załadunek potwierdzony
                </Text>
                {event?.loading_confirmed_at && (
                  <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
                    {new Date(event.loading_confirmed_at).toLocaleString('pl-PL')}
                  </Text>
                )}
              </View>
            </View>
            <Text style={{ color: '#34d399', fontSize: 11, fontWeight: '600' }}>
              {totalCompleted}/{totalItems}
            </Text>
          </View>

          {event?.loading_notes && (
            <View
              style={{
                marginTop: 8,
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                borderRadius: 6,
                padding: 8,
              }}
            >
              <Text style={{ color: '#fbbf24', fontSize: 11 }}>
                <Text style={{ fontWeight: '600' }}>Uwagi: </Text>
                {event.loading_notes}
              </Text>
            </View>
          )}

          {/* Unlock request or admin unlock */}
          {isAdmin ? (
            <TouchableOpacity
              style={{
                marginTop: 8,
                alignSelf: 'flex-start',
                paddingVertical: 6,
                paddingHorizontal: 12,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: 'rgba(211, 187, 115, 0.3)',
              }}
              onPress={handleAdminUnlock}
              activeOpacity={0.7}
            >
              <Text style={{ color: colors.primary.gold, fontSize: 12, fontWeight: '500' }}>
                Odblokuj
              </Text>
            </TouchableOpacity>
          ) : !event?.loading_unlock_requested ? (
            <TouchableOpacity
              style={{
                marginTop: 8,
                alignSelf: 'flex-start',
                paddingVertical: 6,
                paddingHorizontal: 12,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.15)',
              }}
              onPress={() => setShowUnlockModal(true)}
              activeOpacity={0.7}
            >
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
                Poproś o odblokowanie
              </Text>
            </TouchableOpacity>
          ) : (
            <View
              style={{
                marginTop: 8,
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                borderRadius: 6,
                padding: 8,
              }}
            >
              <Text style={{ color: '#fbbf24', fontSize: 11 }}>Prośba o odblokowanie wysłana</Text>
            </View>
          )}
        </View>
      )}

      {/* Progress */}
      {totalItems > 0 && (
        <View style={styles.checklistProgress}>
          <View style={styles.progressBarBg}>
            <View
              style={[styles.progressBarFill, { width: `${(totalCompleted / totalItems) * 100}%` }]}
            />
          </View>
          <Text style={styles.progressText}>
            {totalCompleted}/{totalItems} ukończonych
          </Text>
        </View>
      )}

      {/* Equipment list */}
      {equipment.length > 0 && (
        <View style={styles.checklistSection}>
          <Text style={styles.checklistSectionTitle}>
            Sprzęt ({equipmentLoadedCount}/{equipment.length} załadowano)
          </Text>
          {Object.entries(groupedEquipment).map(([category, items]) => (
            <View key={category}>
              <Text style={styles.equipmentCategoryLabel}>{category}</Text>
              {items.map((item) => {
                const isLoaded = loadedEquipmentIds.has(item.id);
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
                    <TouchableOpacity
                      style={styles.equipmentChecklistContent}
                      onPress={() => onToggleEquipment(item)}
                      activeOpacity={0.7}
                    >
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
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      )}
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
          <Text style={styles.checklistSectionTitle}>Załadunek / Rozładunek</Text>
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

      {/* Confirm Loading Modal */}
      <Modal
        visible={showConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConfirmModal(false)}
      >
        <Pressable
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.7)',
            justifyContent: 'center',
            alignItems: 'center',
          }}
          onPress={() => setShowConfirmModal(false)}
        >
          <Pressable
            style={{
              width: '90%',
              maxWidth: 360,
              backgroundColor: '#1c1f33',
              borderRadius: 14,
              padding: 20,
              borderWidth: 1,
              borderColor: 'rgba(211,187,115,0.2)',
            }}
            onPress={() => {}}
          >
            <Text style={{ color: '#e5e4e2', fontSize: 17, fontWeight: '700', marginBottom: 12 }}>
              Potwierdź załadunek
            </Text>

            <View
              style={{
                backgroundColor: 'rgba(15,17,25,0.8)',
                borderRadius: 8,
                padding: 10,
                marginBottom: 12,
                borderWidth: 1,
                borderColor: 'rgba(211,187,115,0.1)',
              }}
            >
              <Text
                style={{
                  color: allLoaded ? '#34d399' : '#fbbf24',
                  fontSize: 14,
                  fontWeight: '600',
                }}
              >
                {totalCompleted}/{totalItems} {allLoaded ? '- wszystko załadowane' : 'załadowano'}
              </Text>
            </View>

            {!allLoaded && (
              <View style={{ marginBottom: 12 }}>
                <Text
                  style={{
                    color: 'rgba(229,228,226,0.8)',
                    fontSize: 13,
                    fontWeight: '500',
                    marginBottom: 4,
                  }}
                >
                  Uwagi <Text style={{ color: '#f87171' }}>*</Text>
                </Text>
                <Text style={{ color: 'rgba(229,228,226,0.5)', fontSize: 11, marginBottom: 6 }}>
                  Opisz dlaczego nie wszystkie pozycje zostały załadowane
                </Text>
                <TextInput
                  value={loadingNotes}
                  onChangeText={setLoadingNotes}
                  placeholder="np. Mixer w naprawie, kabel pożyczony"
                  placeholderTextColor="rgba(229,228,226,0.3)"
                  multiline
                  numberOfLines={3}
                  style={{
                    backgroundColor: 'rgba(15,17,25,0.8)',
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: 'rgba(211,187,115,0.2)',
                    padding: 10,
                    color: '#e5e4e2',
                    fontSize: 13,
                    minHeight: 70,
                    textAlignVertical: 'top',
                  }}
                />
              </View>
            )}

            <Text style={{ color: 'rgba(229,228,226,0.4)', fontSize: 11, marginBottom: 14 }}>
              Po potwierdzeniu checklista zostanie zablokowana. Cofnięcie wymaga zgody
              administratora.
            </Text>

            <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
              <TouchableOpacity
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: 'rgba(211,187,115,0.2)',
                }}
                onPress={() => {
                  setShowConfirmModal(false);
                  setLoadingNotes('');
                }}
              >
                <Text style={{ color: 'rgba(229,228,226,0.6)', fontSize: 13 }}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  borderRadius: 8,
                  backgroundColor: '#059669',
                }}
                onPress={handleConfirmLoading}
              >
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Potwierdź</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Unlock Request Modal */}
      <Modal
        visible={showUnlockModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowUnlockModal(false)}
      >
        <Pressable
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.7)',
            justifyContent: 'center',
            alignItems: 'center',
          }}
          onPress={() => setShowUnlockModal(false)}
        >
          <Pressable
            style={{
              width: '90%',
              maxWidth: 360,
              backgroundColor: '#1c1f33',
              borderRadius: 14,
              padding: 20,
              borderWidth: 1,
              borderColor: 'rgba(211,187,115,0.2)',
            }}
            onPress={() => {}}
          >
            <Text style={{ color: '#e5e4e2', fontSize: 17, fontWeight: '700', marginBottom: 12 }}>
              Poproś o odblokowanie
            </Text>

            <View style={{ marginBottom: 12 }}>
              <Text
                style={{
                  color: 'rgba(229,228,226,0.8)',
                  fontSize: 13,
                  fontWeight: '500',
                  marginBottom: 4,
                }}
              >
                Powód <Text style={{ color: '#f87171' }}>*</Text>
              </Text>
              <TextInput
                value={unlockReason}
                onChangeText={setUnlockReason}
                placeholder="np. Pomyłkowo zaznaczono sprzęt"
                placeholderTextColor="rgba(229,228,226,0.3)"
                multiline
                numberOfLines={3}
                style={{
                  backgroundColor: 'rgba(15,17,25,0.8)',
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: 'rgba(211,187,115,0.2)',
                  padding: 10,
                  color: '#e5e4e2',
                  fontSize: 13,
                  minHeight: 70,
                  textAlignVertical: 'top',
                }}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
              <TouchableOpacity
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: 'rgba(211,187,115,0.2)',
                }}
                onPress={() => {
                  setShowUnlockModal(false);
                  setUnlockReason('');
                }}
              >
                <Text style={{ color: 'rgba(229,228,226,0.6)', fontSize: 13 }}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  borderRadius: 8,
                  backgroundColor: colors.primary.gold,
                }}
                onPress={handleRequestUnlock}
              >
                <Text style={{ color: '#1c1f33', fontSize: 13, fontWeight: '600' }}>
                  Wyślij prośbę
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
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
  checklistItemTitle: { fontSize: 13, color: colors.text.primary, fontWeight: '500', flex: 1 },
  checklistItemTitleDone: {
    textDecorationLine: 'line-through',
    color: colors.text.tertiary,
  },
  checklistItemMeta: { flexDirection: 'row', gap: 10, marginTop: 2 },
  checklistMetaText: { fontSize: 11, color: colors.text.tertiary },
  checklistContainer: { padding: spacing.md },
  checklistSection: { marginBottom: 20 },
  checklistSectionTitle: {
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
    backgroundColor: colors.primary.gold + '15',
    borderWidth: 1,
    borderColor: colors.primary.gold + '40',
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
  logisticsTitle: { fontSize: 13, color: colors.text.primary, fontWeight: '600', flex: 1 },
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
