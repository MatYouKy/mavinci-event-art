import { View, Text, StyleSheet, TouchableOpacity, Linking, Alert } from 'react-native';
import { colors, spacing } from '../../../theme';
import { Feather } from '@expo/vector-icons';
import { getLocationMapLinks, showLocationDirections } from '../../../lib/locationMaps';

import { InfoRow } from './InfoRow';
import { Employee } from '../../../lib/supabase';
import { EventTeamMember } from './TeamTab';
import { useCrmCall } from '../../../hooks/useCrmCall';
import CallOutcomeModal from '../../CallOutcomeModal';
import type { EventDetailVisibility, EventOnsiteContact } from '../../../lib/eventDetailAccess';

export type EventBillingArrangement = 'direct' | 'hotel' | 'agency' | 'other';

export interface EventBillingContact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
}

export interface EventDetail {
  equipment_checklist_notes?: string | null;
  id: string;
  name: string;
  description: string | null;
  event_date: string;
  event_end_date: string | null;
  status: string;
  notes: string | null;
  expected_revenue: number | null;
  budget: number | null;
  category_name: string | null;
  category_color: string | null;
  location_name: string | null;
  location_address: string | null;
  location_latitude?: number | string | null;
  location_longitude?: number | string | null;
  location_google_place_id?: string | null;
  organization_name: string | null;
  organization_id: string | null;
  billing_arrangement: EventBillingArrangement;
  billing_organization_name: string | null;
  billing_organization_id: string | null;
  billing_contacts: EventBillingContact[];
  contact_name: string | null;
  contact_id: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  creator_name: string | null;
  created_by: string | null;
  loading_confirmed: boolean;
  loading_confirmed_at: string | null;
  loading_confirmed_by: string | null;
  loading_notes: string | null;
  loading_locked: boolean;
  loading_unlock_requested: boolean;
  loading_unlock_requested_at: string | null;
  loading_unlock_requested_by: string | null;
  loading_unlock_reason: string | null;
  employees: EventTeamMember[];
}

const BILLING_ARRANGEMENT_LABELS: Record<EventBillingArrangement, string> = {
  direct: 'Bezpośrednio z klientem',
  hotel: 'Rozliczenie przez hotel',
  agency: 'Rozliczenie przez agencję',
  other: 'Rozliczenie przez inny podmiot',
};

const ONSITE_SOURCE_LABELS: Record<EventOnsiteContact['source'], string> = {
  client: 'Osoba kontaktowa klienta',
  event: 'Kontakt wydarzenia',
  venue: 'Obiekt',
};

function callOnsitePhone(phone: string) {
  const number = phone.replace(/[^+\d]/g, '');
  if (!number) return;
  void Linking.openURL(`tel:${number}`).catch(() =>
    Alert.alert('Kontakt na miejscu', 'Nie udało się otworzyć aplikacji telefonu.'),
  );
}

export function DetailsTab({
  event,
  employee: _employee,
  visibility,
  onsiteContacts,
}: {
  event: EventDetail;
  employee: Employee;
  /** Sekcje według obszarów danych wydarzenia (get_event_access) — `lib/eventDetailAccess`. */
  visibility: EventDetailVisibility;
  /** „Kontakt na miejscu” (get_event_onsite_contacts); null — nie dotyczy albo jeszcze nie pobrano. */
  onsiteContacts: EventOnsiteContact[] | null;
}) {
  const { startCall, pendingCall, showOutcome, closeOutcome } = useCrmCall();
  const mapLocation = {
    name: event.location_name,
    address: event.location_address,
    latitude: event.location_latitude,
    longitude: event.location_longitude,
    googlePlaceId: event.location_google_place_id,
  };
  const hasMapLocation = Boolean(getLocationMapLinks(mapLocation));
  const openDirections = () => showLocationDirections(mapLocation);

  // Dane klienta tylko z obszarem „Dane klienta”; rozliczenie — „Faktury i rozliczenie”; kwoty — „Kwoty i kalkulacje”.
  const showClient = visibility.client && Boolean(event.organization_name || event.contact_name);
  const showOnsite = !visibility.client && visibility.onsiteContact && onsiteContacts !== null;
  const canViewBilling = visibility.billing;
  const canViewValues = visibility.values;
  const hasExpectedRevenue = typeof event.expected_revenue === 'number';
  const hasBudget = typeof event.budget === 'number';

  const formatDateTime = (dateStr: string) =>
    new Date(dateStr).toLocaleString('pl-PL', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

  const formatCurrency = (val: number) =>
    `${val.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł`;

  return (
    <View>
      {/* Date & location */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data i miejsce</Text>
        <View style={styles.infoGrid}>
          <InfoRow icon="calendar" label="Rozpoczęcie" value={formatDateTime(event.event_date)} />
          {Boolean(event.event_end_date) && (
            <InfoRow
              icon="clock"
              label="Zakończenie"
              value={formatDateTime(event.event_end_date)}
            />
          )}
          {Boolean(event.location_name) && (
            <TouchableOpacity onPress={openDirections} accessibilityRole="button" accessibilityLabel={`Otwórz lokalizację: ${event.location_name}`} style={styles.locationRow}>
              <InfoRow icon="map-pin" label="Lokalizacja" value={event.location_name} highlight />
            </TouchableOpacity>
          )}
          {Boolean(event.location_address) && (
            <TouchableOpacity onPress={openDirections} accessibilityRole="button" accessibilityLabel={`Wyznacz trasę do: ${event.location_address}`} style={styles.locationRow}>
              <InfoRow icon="navigation" label="Adres" value={event.location_address} highlight />
            </TouchableOpacity>
          )}
          {hasMapLocation && (
            <TouchableOpacity onPress={openDirections} accessibilityRole="button" accessibilityHint="Otwiera wybór aplikacji z mapami" style={styles.directionsButton}>
              <Feather name="navigation" size={18} color={colors.primary.gold} />
              <Text style={styles.directionsText}>Wyznacz trasę</Text>
              <Feather name="external-link" size={15} color={colors.primary.gold} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Client */}
      {showClient && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Klient</Text>
          <View style={styles.infoGrid}>
            {Boolean(event.organization_name) && (
              <InfoRow icon="briefcase" label="Firma" value={event.organization_name} />
            )}
            {Boolean(event.contact_name) && (
              <InfoRow icon="user" label="Osoba kontaktowa" value={event.contact_name} />
            )}
            {Boolean(event.contact_phone) && (
              <TouchableOpacity onPress={() => void startCall({ phoneNumber: event.contact_phone!, displayName: event.contact_name || event.organization_name || event.name, contactId: event.contact_id, organizationId: event.organization_id, eventId: event.id })}>
                <InfoRow icon="phone" label="Telefon" value={event.contact_phone} highlight />
              </TouchableOpacity>
            )}
            {Boolean(event.contact_email) && (
              <TouchableOpacity onPress={() => Linking.openURL(`mailto:${event.contact_email}`)}>
                <InfoRow icon="mail" label="Email" value={event.contact_email} highlight />
              </TouchableOpacity>
            )}
            {Boolean(event.creator_name) && (
              <InfoRow icon="edit-3" label="Autor" value={event.creator_name} />
            )}
          </View>
        </View>
      )}

      {/* Kontakt na miejscu — bez karty klienta (kierownik realizacji, kierowca, prowadzący) */}
      {showOnsite && onsiteContacts && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Kontakt na miejscu</Text>
          {onsiteContacts.length === 0 ? (
            <Text style={styles.emptyText}>Nie wskazano kontaktu na miejscu.</Text>
          ) : (
            <View style={styles.infoGrid}>
              {onsiteContacts.map((contact, index) => (
                <View
                  key={`${contact.source}-${contact.name}-${contact.phone ?? ''}-${index}`}
                  style={[styles.onsiteContact, index > 0 && styles.onsiteContactNext]}
                >
                  <InfoRow
                    icon={contact.source === 'venue' ? 'home' : 'user'}
                    label={contact.role || ONSITE_SOURCE_LABELS[contact.source]}
                    value={contact.is_primary ? `${contact.name} · główny kontakt` : contact.name}
                  />
                  {Boolean(contact.phone) && (
                    <TouchableOpacity
                      onPress={() => callOnsitePhone(contact.phone!)}
                      accessibilityRole="button"
                      accessibilityLabel={`Zadzwoń: ${contact.name}`}
                    >
                      <InfoRow icon="phone" label="Telefon" value={contact.phone ?? ''} highlight />
                    </TouchableOpacity>
                  )}
                  {Boolean(contact.notes) && <Text style={styles.onsiteNotes}>{contact.notes}</Text>}
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Autor wydarzenia, gdy sekcja klienta jest ukryta */}
      {!showClient && Boolean(event.creator_name) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wydarzenie</Text>
          <View style={styles.infoGrid}>
            <InfoRow icon="edit-3" label="Autor" value={event.creator_name} />
          </View>
        </View>
      )}

      {canViewBilling && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Rozliczenie wydarzenia</Text>
          <View style={styles.infoGrid}>
            <InfoRow
              icon="credit-card"
              label="Sposób rozliczenia"
              value={BILLING_ARRANGEMENT_LABELS[event.billing_arrangement]}
            />
            <InfoRow
              icon="briefcase"
              label={event.billing_arrangement === 'direct' ? 'Nabywca' : 'Nabywca / płatnik'}
              value={
                event.billing_organization_name || event.organization_name || 'Nie wskazano'
              }
            />
            {event.billing_contacts.map((contact) => (
              <View key={contact.id} style={styles.billingContact}>
                <InfoRow
                  icon="user-check"
                  label={contact.is_primary ? 'Główny kontakt rozliczeniowy' : 'Kontakt rozliczeniowy'}
                  value={contact.name}
                />
                {Boolean(contact.phone) && (
                  <TouchableOpacity
                    onPress={() =>
                      void startCall({
                        phoneNumber: contact.phone!,
                        displayName: contact.name,
                        contactId: contact.id,
                        organizationId: event.billing_organization_id,
                        eventId: event.id,
                      })
                    }
                  >
                    <InfoRow icon="phone" label="Telefon" value={contact.phone} highlight />
                  </TouchableOpacity>
                )}
                {Boolean(contact.email) && (
                  <TouchableOpacity onPress={() => Linking.openURL(`mailto:${contact.email}`)}>
                    <InfoRow icon="mail" label="E-mail" value={contact.email} highlight />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Kwoty — tylko z obszarem „Kwoty i kalkulacje” (event_financials) */}
      {canViewValues && (hasExpectedRevenue || hasBudget) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Finanse</Text>
          <View style={styles.infoGrid}>
            {hasExpectedRevenue && (
              <InfoRow
                icon="trending-up"
                label="Przychód"
                value={formatCurrency(event.expected_revenue)}
              />
            )}
            {hasBudget && (
              <InfoRow icon="dollar-sign" label="Budżet" value={formatCurrency(event.budget)} />
            )}
          </View>
        </View>
      )}

      {/* Description */}
      {Boolean(event.description) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Opis</Text>
          <Text style={styles.descriptionText}>{event.description}</Text>
        </View>
      )}

      {/* Notes */}
      {Boolean(event.notes) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notatki</Text>
          <Text style={styles.descriptionText}>{event.notes}</Text>
        </View>
      )}
      <CallOutcomeModal call={pendingCall} visible={showOutcome} onClose={closeOutcome} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  sectionTitle: {
    fontFamily: 'MBFAtom',
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  infoGrid: { gap: 8 },
  locationRow: { minHeight: 44, justifyContent: 'center', paddingVertical: 6 },
  directionsButton: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 4,
    borderRadius: 10,
    backgroundColor: colors.background.elevated,
  },
  directionsText: { color: colors.primary.gold, fontSize: 14, fontWeight: '600' },
  billingContact: {
    gap: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
    paddingTop: 8,
  },
  descriptionText: { fontSize: 13, color: colors.text.secondary, lineHeight: 20 },
  emptyText: { fontSize: 13, color: colors.text.tertiary },
  onsiteContact: { gap: 8 },
  onsiteContactNext: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
    paddingTop: 8,
  },
  onsiteNotes: { fontSize: 12, color: colors.text.secondary, lineHeight: 18 },
});
