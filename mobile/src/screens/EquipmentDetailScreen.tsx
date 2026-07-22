import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  RefreshControl,
  Linking,
  TouchableOpacity,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import { supabase } from '../lib/supabase';

interface EquipmentDetail {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  notes: string | null;
  thumbnail_url: string | null;
  weight_kg: number | null;
  dimensions_cm: { width?: number; height?: number; depth?: number; length?: number } | null;
  serial_number: string | null;
  barcode: string | null;
  user_manual_url: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  current_value: number | null;
  warranty_until: string | null;
  rental_price_per_day: number | null;
  power_specs: {
    power_watts?: number;
    current_amps?: number;
    voltage_volts?: number;
    power_phase?: string;
    power_notes?: string;
  } | null;
  cable_specs: {
    length_meters?: number;
    connector_in?: string;
    connector_out?: string;
  } | null;
  warehouse_category_id: string | null;
  storage_location_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface EquipmentUnit {
  id: string;
  serial_number: string | null;
  internal_id: string | null;
  status: string;
  notes: string | null;
  condition: string | null;
}

interface Props {
  equipmentId: string;
  isKit?: boolean;
  onBack: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  available: 'Dostępny',
  in_use: 'W użyciu',
  reserved: 'Zarezerwowany',
  damaged: 'Uszkodzony',
  in_service: 'W serwisie',
  sold: 'Sprzedany',
};

const STATUS_COLORS: Record<string, string> = {
  available: colors.status.success,
  in_use: colors.status.info,
  reserved: colors.status.warning,
  damaged: colors.status.error,
  in_service: '#f97316',
  sold: colors.text.tertiary,
};

export default function EquipmentDetailScreen({ equipmentId, isKit, onBack }: Props) {
  const [equipment, setEquipment] = useState<EquipmentDetail | null>(null);
  const [units, setUnits] = useState<EquipmentUnit[]>([]);
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [locationName, setLocationName] = useState<string | null>(null);
  const [gallery, setGallery] = useState<string[]>([]);
  const [kitItems, setKitItems] = useState<{ id: string; name: string; quantity: number }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDetail = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setIsLoading(true);

    try {
      if (isKit) {
        const { data } = await supabase
          .from('equipment_kits')
          .select(`
            id, name, description, thumbnail_url, warehouse_category_id, is_active,
            created_at, updated_at,
            warehouse_categories ( name )
          `)
          .eq('id', equipmentId)
          .maybeSingle();

        if (data) {
          setEquipment({
            id: data.id,
            name: data.name,
            brand: null,
            model: null,
            description: data.description,
            notes: null,
            thumbnail_url: data.thumbnail_url,
            weight_kg: null,
            dimensions_cm: null,
            serial_number: null,
            barcode: null,
            user_manual_url: null,
            purchase_date: null,
            purchase_price: null,
            current_value: null,
            warranty_until: null,
            rental_price_per_day: null,
            power_specs: null,
            cable_specs: null,
            warehouse_category_id: data.warehouse_category_id,
            storage_location_id: null,
            is_active: data.is_active,
            created_at: data.created_at,
            updated_at: data.updated_at,
          });
          setCategoryName((data as any).warehouse_categories?.name ?? null);

          // Fetch kit components
          const { data: components } = await supabase
            .from('equipment_kit_items')
            .select('id, quantity, equipment_items ( name )')
            .eq('kit_id', equipmentId);

          if (components) {
            setKitItems(
              components.map((c: any) => ({
                id: c.id,
                name: c.equipment_items?.name ?? 'Nieznany',
                quantity: c.quantity ?? 1,
              }))
            );
          }
        }
      } else {
        const { data } = await supabase
          .from('equipment_items')
          .select(`
            id, name, brand, model, description, notes, thumbnail_url,
            weight_kg, dimensions_cm, serial_number, barcode, user_manual_url,
            purchase_date, purchase_price, current_value, warranty_until,
            rental_price_per_day, power_specs, cable_specs,
            warehouse_category_id, storage_location_id, is_active,
            created_at, updated_at,
            warehouse_categories ( name )
          `)
          .eq('id', equipmentId)
          .maybeSingle();

        if (data) {
          setEquipment(data as any);
          setCategoryName((data as any).warehouse_categories?.name ?? null);

          if (data.storage_location_id) {
            const { data: loc } = await supabase
              .from('storage_locations')
              .select('name')
              .eq('id', data.storage_location_id)
              .maybeSingle();
            setLocationName(loc?.name ?? null);
          }
        }

        // Fetch units
        const { data: unitsData } = await supabase
          .from('equipment_units')
          .select('id, serial_number, internal_id, status, notes, condition')
          .eq('equipment_id', equipmentId)
          .order('internal_id');

        setUnits(unitsData ?? []);

        // Fetch gallery
        const { data: galleryData } = await supabase
          .from('equipment_images')
          .select('image_url')
          .eq('equipment_id', equipmentId)
          .order('order_index');

        setGallery((galleryData ?? []).map((g: any) => g.image_url));
      }
    } catch (error) {
      console.error('Error fetching equipment detail:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [equipmentId]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary.gold} />
      </View>
    );
  }

  if (!equipment) {
    return (
      <View style={styles.loadingContainer}>
        <Feather name="alert-circle" size={48} color={colors.text.tertiary} />
        <Text style={styles.errorText}>Nie znaleziono sprzętu</Text>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>Wróć</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const availableUnits = units.filter((u) => u.status === 'available').length;
  const totalUnits = units.length;
  const hasPowerSpecs =
    equipment.power_specs &&
    (equipment.power_specs.power_watts ||
      equipment.power_specs.current_amps ||
      equipment.power_specs.voltage_volts);
  const hasDimensions =
    equipment.dimensions_cm &&
    (equipment.dimensions_cm.width || equipment.dimensions_cm.height || equipment.dimensions_cm.depth || equipment.dimensions_cm.length);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerBack}>
          <Feather name="arrow-left" size={22} color={colors.text.primary} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {equipment.name}
          </Text>
          {(equipment.brand || equipment.model) && (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {[equipment.brand, equipment.model].filter(Boolean).join(' ')}
            </Text>
          )}
        </View>
        {!isKit && totalUnits > 0 && (
          <View style={styles.availBadge}>
            <Text style={styles.availBadgeText}>
              {availableUnits}/{totalUnits}
            </Text>
          </View>
        )}
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchDetail(true)}
            tintColor={colors.primary.gold}
          />
        }
      >
        {/* Thumbnail */}
        {equipment.thumbnail_url && (
          <View style={styles.imageSection}>
            <Image source={{ uri: equipment.thumbnail_url }} style={styles.mainImage} />
          </View>
        )}

        {/* Quick info section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Informacje</Text>
          <View style={styles.infoGrid}>
            {categoryName && <InfoRow icon="folder" label="Kategoria" value={categoryName} />}
            {equipment.brand && <InfoRow icon="tag" label="Marka" value={equipment.brand} />}
            {equipment.model && <InfoRow icon="cpu" label="Model" value={equipment.model} />}
            {equipment.serial_number && (
              <InfoRow icon="hash" label="Nr seryjny" value={equipment.serial_number} />
            )}
            {equipment.barcode && <InfoRow icon="maximize" label="Kod kreskowy" value={equipment.barcode} />}
            {locationName && <InfoRow icon="map-pin" label="Lokalizacja" value={locationName} />}
          </View>
        </View>

        {/* Description */}
        {equipment.description && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Opis</Text>
            <Text style={styles.descriptionText}>{equipment.description}</Text>
          </View>
        )}

        {/* Technical specs */}
        {(equipment.weight_kg || hasDimensions || equipment.cable_specs) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Dane techniczne</Text>
            <View style={styles.infoGrid}>
              {equipment.weight_kg && (
                <InfoRow icon="box" label="Waga" value={`${equipment.weight_kg} kg`} />
              )}
              {hasDimensions && (
                <InfoRow
                  icon="maximize-2"
                  label="Wymiary"
                  value={formatDimensions(equipment.dimensions_cm!)}
                />
              )}
              {equipment.cable_specs?.length_meters && (
                <InfoRow icon="link" label="Długość" value={`${equipment.cable_specs.length_meters} m`} />
              )}
              {equipment.cable_specs?.connector_in && (
                <InfoRow icon="arrow-right-circle" label="Wtyk wejściowy" value={equipment.cable_specs.connector_in} />
              )}
              {equipment.cable_specs?.connector_out && (
                <InfoRow icon="arrow-left-circle" label="Wtyk wyjściowy" value={equipment.cable_specs.connector_out} />
              )}
            </View>
          </View>
        )}

        {/* Power specs */}
        {hasPowerSpecs && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Zasilanie</Text>
            <View style={styles.infoGrid}>
              {equipment.power_specs!.power_watts && (
                <InfoRow icon="zap" label="Moc" value={`${equipment.power_specs!.power_watts} W`} />
              )}
              {equipment.power_specs!.current_amps && (
                <InfoRow icon="activity" label="Prąd" value={`${equipment.power_specs!.current_amps} A`} />
              )}
              {equipment.power_specs!.voltage_volts && (
                <InfoRow icon="battery-charging" label="Napięcie" value={`${equipment.power_specs!.voltage_volts} V`} />
              )}
              {equipment.power_specs!.power_phase && (
                <InfoRow
                  icon="repeat"
                  label="Faza"
                  value={equipment.power_specs!.power_phase === 'three_phase' ? '3-fazowe' : '1-fazowe'}
                />
              )}
              {equipment.power_specs!.power_notes && (
                <InfoRow icon="file-text" label="Uwagi" value={equipment.power_specs!.power_notes} />
              )}
            </View>
          </View>
        )}

        {/* Purchase / Financial */}
        {(equipment.purchase_date || equipment.purchase_price || equipment.warranty_until) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Zakup i gwarancja</Text>
            <View style={styles.infoGrid}>
              {equipment.purchase_date && (
                <InfoRow icon="calendar" label="Data zakupu" value={formatDate(equipment.purchase_date)} />
              )}
              {equipment.purchase_price && (
                <InfoRow icon="dollar-sign" label="Cena zakupu" value={formatCurrency(equipment.purchase_price)} />
              )}
              {equipment.current_value && (
                <InfoRow icon="trending-down" label="Obecna wartość" value={formatCurrency(equipment.current_value)} />
              )}
              {equipment.rental_price_per_day && (
                <InfoRow icon="repeat" label="Cena wynajmu/dzień" value={formatCurrency(equipment.rental_price_per_day)} />
              )}
              {equipment.warranty_until && (
                <InfoRow
                  icon="shield"
                  label="Gwarancja do"
                  value={formatDate(equipment.warranty_until)}
                  highlight={new Date(equipment.warranty_until) > new Date()}
                />
              )}
            </View>
          </View>
        )}

        {/* Units */}
        {units.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Jednostki ({availableUnits}/{totalUnits} dostępnych)
            </Text>
            {units.map((unit) => (
              <View key={unit.id} style={styles.unitRow}>
                <View
                  style={[styles.unitStatusDot, { backgroundColor: STATUS_COLORS[unit.status] || colors.text.tertiary }]}
                />
                <View style={styles.unitInfo}>
                  <Text style={styles.unitId}>
                    {unit.internal_id || unit.serial_number || unit.id.slice(0, 8)}
                  </Text>
                  <Text style={styles.unitStatus}>
                    {STATUS_LABELS[unit.status] || unit.status}
                  </Text>
                </View>
                {unit.condition && (
                  <Text style={styles.unitCondition}>{unit.condition}</Text>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Kit components */}
        {isKit && kitItems.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Składniki zestawu</Text>
            {kitItems.map((item) => (
              <View key={item.id} style={styles.kitItemRow}>
                <Feather name="check-circle" size={14} color={colors.primary.gold} />
                <Text style={styles.kitItemName}>{item.name}</Text>
                {item.quantity > 1 && (
                  <Text style={styles.kitItemQty}>x{item.quantity}</Text>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Gallery */}
        {gallery.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Galeria</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {gallery.map((url, idx) => (
                <Image key={idx} source={{ uri: url }} style={styles.galleryImage} />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Manual link */}
        {equipment.user_manual_url && (
          <TouchableOpacity
            style={styles.manualLink}
            onPress={() => Linking.openURL(equipment.user_manual_url!)}
          >
            <Feather name="external-link" size={16} color={colors.primary.gold} />
            <Text style={styles.manualLinkText}>Instrukcja obsługi</Text>
          </TouchableOpacity>
        )}

        {/* Notes */}
        {equipment.notes && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notatki</Text>
            <Text style={styles.descriptionText}>{equipment.notes}</Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function InfoRow({
  icon,
  label,
  value,
  highlight,
}: {
  icon: string;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <Feather name={icon as any} size={14} color={colors.text.tertiary} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, highlight && styles.infoValueHighlight]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatCurrency(value: number): string {
  return `${value.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł`;
}

function formatDimensions(dims: { width?: number; height?: number; depth?: number; length?: number }): string {
  const parts: string[] = [];
  if (dims.length) parts.push(`${dims.length}`);
  if (dims.width) parts.push(`${dims.width}`);
  if (dims.height) parts.push(`${dims.height}`);
  if (dims.depth) parts.push(`${dims.depth}`);
  return parts.join(' x ') + ' cm';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.primary,
    gap: spacing.md,
  },
  errorText: {
    fontSize: 15,
    color: colors.text.secondary,
  },
  backBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.background.secondary,
    borderRadius: 8,
    marginTop: spacing.sm,
  },
  backBtnText: {
    color: colors.primary.gold,
    fontWeight: '600',
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.background.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  headerBack: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.text.secondary,
    marginTop: 1,
  },
  availBadge: {
    backgroundColor: colors.status.success + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  availBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.status.success,
  },
  scrollView: {
    flex: 1,
  },
  imageSection: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    backgroundColor: colors.background.secondary,
  },
  mainImage: {
    width: 200,
    height: 200,
    borderRadius: 12,
    backgroundColor: colors.background.tertiary,
  },
  section: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  infoGrid: {
    gap: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  infoLabel: {
    fontSize: 12,
    color: colors.text.tertiary,
    width: 100,
  },
  infoValue: {
    flex: 1,
    fontSize: 13,
    color: colors.text.primary,
    fontWeight: '500',
  },
  infoValueHighlight: {
    color: colors.status.success,
  },
  descriptionText: {
    fontSize: 13,
    color: colors.text.secondary,
    lineHeight: 20,
  },
  unitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    gap: 10,
  },
  unitStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  unitInfo: {
    flex: 1,
  },
  unitId: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text.primary,
  },
  unitStatus: {
    fontSize: 11,
    color: colors.text.tertiary,
    marginTop: 1,
  },
  unitCondition: {
    fontSize: 11,
    color: colors.text.secondary,
    backgroundColor: colors.background.tertiary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  kitItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  kitItemName: {
    flex: 1,
    fontSize: 13,
    color: colors.text.primary,
  },
  kitItemQty: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary.gold,
  },
  galleryImage: {
    width: 120,
    height: 90,
    borderRadius: 8,
    marginRight: 8,
    backgroundColor: colors.background.tertiary,
  },
  manualLink: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  manualLinkText: {
    fontSize: 14,
    color: colors.primary.gold,
    fontWeight: '600',
  },
});
