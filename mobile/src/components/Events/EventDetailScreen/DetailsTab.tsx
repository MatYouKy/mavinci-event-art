import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { colors, spacing } from '../../../theme';

import { InfoRow } from './InfoRow';
import { Employee } from '../../../lib/supabase';
import { EventTeamMember } from './TeamTab';
import { useCrmCall } from '../../../hooks/useCrmCall';
import CallOutcomeModal from '../../CallOutcomeModal';

export interface EventDetail {
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
  organization_name: string | null;
  organization_id: string | null;
  contact_name: string | null;
  contact_id: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  creator_name: string | null;
  created_by: string | null;
  employees: EventTeamMember[];
}

export function DetailsTab({ event, employee }: { event: EventDetail; employee: Employee }) {
  const { startCall, pendingCall, showOutcome, closeOutcome } = useCrmCall();
  const permissions = employee?.permissions ?? [];

  const canViewFinances =
    permissions.includes('finances_manage') ||
    permissions.includes('finances_view') ||
    permissions.includes('offers_manage') ||
    permissions.includes('offers_view') ||
    permissions.includes('invoices_manage') ||
    permissions.includes('invoices_view') ||
    employee.role === 'admin';
  console.log('canViewFinances -> ', canViewFinances);
  console.log('employee.role -> ', employee.role);
  console.log('event.expected_revenue -> ', event.expected_revenue);

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
          {event.event_end_date && (
            <InfoRow
              icon="clock"
              label="Zakończenie"
              value={formatDateTime(event.event_end_date)}
            />
          )}
          {event.location_name && (
            <InfoRow icon="map-pin" label="Lokalizacja" value={event.location_name} />
          )}
          {event.location_address && (
            <InfoRow icon="navigation" label="Adres" value={event.location_address} />
          )}
        </View>
      </View>

      {/* Client */}
      {(event.organization_name || event.contact_name) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Klient</Text>
          <View style={styles.infoGrid}>
            {event.organization_name && (
              <InfoRow icon="briefcase" label="Firma" value={event.organization_name} />
            )}
            {event.contact_name && (
              <InfoRow icon="user" label="Osoba kontaktowa" value={event.contact_name} />
            )}
            {event.contact_phone && (
              <TouchableOpacity onPress={() => void startCall({ phoneNumber: event.contact_phone!, displayName: event.contact_name || event.organization_name || event.name, contactId: event.contact_id, organizationId: event.organization_id, eventId: event.id })}>
                <InfoRow icon="phone" label="Telefon" value={event.contact_phone} highlight />
              </TouchableOpacity>
            )}
            {event.contact_email && (
              <TouchableOpacity onPress={() => Linking.openURL(`mailto:${event.contact_email}`)}>
                <InfoRow icon="mail" label="Email" value={event.contact_email} highlight />
              </TouchableOpacity>
            )}
            {event.creator_name && (
              <InfoRow icon="edit-3" label="Autor" value={event.creator_name} />
            )}
          </View>
        </View>
      )}

      {/* Financial - only for authorized employees */}
      {canViewFinances && (event.expected_revenue || event.budget) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Finanse</Text>
          <View style={styles.infoGrid}>
            {event.expected_revenue && (
              <InfoRow
                icon="trending-up"
                label="Przychód"
                value={formatCurrency(event.expected_revenue)}
              />
            )}
            {event.budget && (
              <InfoRow icon="dollar-sign" label="Budżet" value={formatCurrency(event.budget)} />
            )}
          </View>
        </View>
      )}

      {/* Description */}
      {event.description && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Opis</Text>
          <Text style={styles.descriptionText}>{event.description}</Text>
        </View>
      )}

      {/* Notes */}
      {event.notes && (
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
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  infoGrid: { gap: 8 },
  descriptionText: { fontSize: 13, color: colors.text.secondary, lineHeight: 20 },
});
