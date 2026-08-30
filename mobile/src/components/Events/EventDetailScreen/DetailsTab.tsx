import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { colors, spacing } from '../../../theme';

import { InfoRow } from './InfoRow';
import { Employee } from '../../../lib/supabase';
import { EventTeamMember } from './TeamTab';
import { useCrmCall } from '../../../hooks/useCrmCall';
import CallOutcomeModal from '../../CallOutcomeModal';

export type EventBillingArrangement = 'direct' | 'hotel' | 'agency' | 'other';

export interface EventBillingContact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
}

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
            <InfoRow icon="map-pin" label="Lokalizacja" value={event.location_name} />
          )}
          {Boolean(event.location_address) && (
            <InfoRow icon="navigation" label="Adres" value={event.location_address} />
          )}
        </View>
      </View>

      {/* Client */}
      {Boolean(event.organization_name || event.contact_name) && (
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

      {canViewFinances && (
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

      {/* Financial - only for authorized employees */}
      {canViewFinances && (hasExpectedRevenue || hasBudget) && (
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
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  infoGrid: { gap: 8 },
  billingContact: {
    gap: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
    paddingTop: 8,
  },
  descriptionText: { fontSize: 13, color: colors.text.secondary, lineHeight: 20 },
});
