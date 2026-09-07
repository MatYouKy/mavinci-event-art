'use client';

import { useState } from 'react';
import { UserCircle, Plus, Trash2, Check, Shield, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { getOrganizationRegistryProfile } from '@/lib/organizations/organizationLegalForm';

interface Contact {
  id: string;
  full_name: string;
  first_name?: string;
  last_name?: string;
  email?: string | null;
  phone?: string | null;
  position?: string | null;
}

interface DecisionMaker {
  id: string;
  contact_id: string;
  title: string | null;
  can_sign_contracts: boolean;
  notes: string | null;
  contact?: Contact;
}

interface Props {
  organizationId: string;
  primaryContact: Contact | null;
  legalRepresentative: Contact | null;
  legalRepresentativeTitle: string | null;
  contactIsRepresentative: boolean;
  decisionMakers: DecisionMaker[];
  availableContacts: Contact[];
  editMode: boolean;
  onUpdate: () => void;
  onEditedDataChange: (field: string, value: any) => void;
  editedPrimaryContactId: string | null;
  editedLegalRepresentativeId: string | null;
  representationType: RepresentationType | null;
  representationRule: string | null;
  representationBasis: string | null;
  representationVerifiedAt: string | null;
  legalForm: string | null;
}

type RepresentationType = 'sole' | 'joint' | 'joint_with_proxy' | 'proxy' | 'other';

const REPRESENTATION_TYPE_LABELS: Record<RepresentationType, string> = {
  sole: 'Samodzielna',
  joint: 'Łączna',
  joint_with_proxy: 'Łączna z prokurentem',
  proxy: 'Pełnomocnik / prokurent',
  other: 'Inny sposób',
};

export default function OrganizationRepresentatives({
  organizationId,
  primaryContact,
  legalRepresentative,
  legalRepresentativeTitle,
  contactIsRepresentative,
  decisionMakers,
  availableContacts,
  editMode,
  onUpdate,
  onEditedDataChange,
  editedPrimaryContactId,
  editedLegalRepresentativeId,
  representationType,
  representationRule,
  representationBasis,
  representationVerifiedAt,
  legalForm,
}: Props) {
  const { showSnackbar } = useSnackbar();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newDM, setNewDM] = useState({
    contact_id: '',
    title: '',
    can_sign_contracts: false,
  });

  const selectedLegalRep =
    (editedLegalRepresentativeId
      ? availableContacts.find((c) => c.id === editedLegalRepresentativeId)
      : null) || null;

  // ✅ fallback do wyświetlania po zapisaniu / gdy join jeszcze nie przyszedł
  const displayLegalRepresentative = legalRepresentative || selectedLegalRep;
  const primaryRepresentativeId = contactIsRepresentative
    ? editedPrimaryContactId || primaryContact?.id || null
    : editedLegalRepresentativeId || displayLegalRepresentative?.id || null;
  const additionalSignerIds = new Set(
    decisionMakers
      .filter((person) => person.can_sign_contracts)
      .map((person) => person.contact_id),
  );
  if (primaryRepresentativeId) additionalSignerIds.add(primaryRepresentativeId);
  const signerCount = additionalSignerIds.size;
  const assignedDecisionMakerContactIds = new Set(
    decisionMakers.map((person) => person.contact_id),
  );
  const availableDecisionMakerContacts = availableContacts.filter(
    (contact) => !assignedDecisionMakerContactIds.has(contact.id),
  );
  const needsJointSigners = ['joint', 'joint_with_proxy'].includes(representationType || '');
  const registryProfile = getOrganizationRegistryProfile({ legalForm });
  const representationHelp =
    registryProfile === 'krs'
      ? 'Przepisz dokładną zasadę z Działu 2 KRS. Samo nazwisko reprezentanta nie potwierdza, czy może on podpisać umowę samodzielnie.'
      : registryProfile === 'ceidg'
        ? 'Wskaż właściciela ujawnionego w CEIDG albo osobę działającą na podstawie pełnomocnictwa.'
        : registryProfile === 'civil_partnership'
          ? 'Wskaż wspólnika lub pełnomocnika oraz podstawę jego umocowania (CEIDG, umowa spółki albo pełnomocnictwo).'
          : registryProfile === 'institution'
            ? 'Wskaż dyrektora, kierownika lub pełnomocnika oraz dokument, statut albo przepis stanowiący podstawę umocowania.'
            : 'Wskaż osobę uprawnioną i rejestr, statut, uchwałę lub pełnomocnictwo stanowiące podstawę umocowania.';

  const handleAddDecisionMaker = async () => {
    if (!newDM.contact_id) return;

    try {
      const { error } = await supabase.from('organization_decision_makers').insert({
        organization_id: organizationId,
        contact_id: newDM.contact_id,
        title: newDM.title || null,
        can_sign_contracts: newDM.can_sign_contracts,
      });
      if (error) throw error;

      showSnackbar('Osoba decyzyjna dodana', 'success');
      setShowAddModal(false);
      setNewDM({ contact_id: '', title: '', can_sign_contracts: false });
      onUpdate();
    } catch (error) {
      console.error('Error adding decision maker:', error);
      showSnackbar('Błąd podczas dodawania osoby decyzyjnej', 'error');
    }
  };

  const handleRemoveDecisionMaker = async (id: string) => {
    if (!confirm('Usunąć osobę decyzyjną?')) return;

    try {
      const { error } = await supabase.from('organization_decision_makers').delete().eq('id', id);
      if (error) throw error;
      showSnackbar('Osoba decyzyjna usunięta', 'success');
      onUpdate();
    } catch (error) {
      console.error('Error removing decision maker:', error);
      showSnackbar('Błąd podczas usuwania osoby decyzyjnej', 'error');
    }
  };

  const handleSignerPermissionChange = async (person: DecisionMaker, checked: boolean) => {
    try {
      const { error } = await supabase
        .from('organization_decision_makers')
        .update({ can_sign_contracts: checked })
        .eq('id', person.id);
      if (error) throw error;
      showSnackbar(
        checked
          ? 'Osoba została oznaczona jako uprawniona do podpisu'
          : 'Usunięto uprawnienie do podpisu',
        'success',
      );
      onUpdate();
    } catch (error) {
      console.error('Error updating signer permission:', error);
      showSnackbar('Nie udało się zmienić uprawnienia do podpisu', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Główna osoba kontaktowa */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/30 p-4">
        <div className="mb-3 flex items-center gap-2">
          <UserCircle className="h-5 w-5 text-blue-400" />
          <h3 className="font-semibold text-white">Osoba kontaktowa</h3>
        </div>
        {editMode ? (
          <>
            <select
              value={editedPrimaryContactId || ''}
              onChange={(e) => onEditedDataChange('primary_contact_id', e.target.value || null)}
              disabled={availableContacts.length === 0}
              className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">
                {availableContacts.length === 0
                  ? '-- Brak osób kontaktowych (dodaj w zakładce Kontakty) --'
                  : '-- Wybierz osobę --'}
              </option>
              {availableContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name} {c.position ? `(${c.position})` : ''}
                </option>
              ))}
            </select>
            {availableContacts.length === 0 && (
              <div className="mt-2 text-xs text-amber-400">
                💡 Najpierw dodaj osoby kontaktowe w zakładce &quot;Kontakty&quot; poniżej
              </div>
            )}
          </>
        ) : primaryContact ? (
          <div className="text-sm text-gray-300">
            <div className="font-medium">{primaryContact.full_name}</div>
            {primaryContact.position && (
              <div className="text-gray-400">{primaryContact.position}</div>
            )}
            {primaryContact.email && <div className="text-gray-400">{primaryContact.email}</div>}
            {primaryContact.phone && <div className="text-gray-400">{primaryContact.phone}</div>}
          </div>
        ) : (
          <div className="text-sm text-gray-500">Nie wybrano</div>
        )}
      </div>

      {/* Reprezentant prawny */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/30 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Shield className="h-5 w-5 text-amber-400" />
          <h3 className="font-semibold text-white">Reprezentant / osoba uprawniona</h3>
        </div>

        {editMode && (
          <div className="mb-3 flex items-center gap-2">
            <input
              type="checkbox"
              checked={contactIsRepresentative}
              onChange={(e) => onEditedDataChange('contact_is_representative', e.target.checked)}
              className="h-4 w-4 rounded border-gray-600 bg-gray-800"
            />
            <label className="text-sm text-gray-300">
              Osoba kontaktowa jest też osobą uprawnioną do zawarcia umowy
            </label>
          </div>
        )}

        {!contactIsRepresentative && (
          <>
            {editMode ? (
              <div className="space-y-3">
                <select
                  value={editedLegalRepresentativeId || ''}
                  onChange={(e) => {
                    const nextId = e.target.value || null;

                    // 1) ustaw ID
                    onEditedDataChange('legal_representative_id', nextId);

                    // ✅ jak ktoś kliknął "-- Wybierz osobę --" → wyczyść stanowisko
                    if (!nextId) {
                      onEditedDataChange('legal_representative_title', null);
                      return;
                    }

                    // 3) znajdź kontakt
                    const selected = availableContacts.find((c) => c.id === nextId);
                    if (!selected) return;

                    // 4) wyciągnij stanowisko z kontaktu (dopasuj nazwy pól do Twojego modelu)
                    const pickedTitle =
                      (selected as any).title ||
                      (selected as any).position ||
                      (selected as any).job_title ||
                      (selected as any).role ||
                      (selected as any).company_title ||
                      null;

                    // 5) ustaw stanowisko TYLKO jeśli:
                    // - kontakt ma stanowisko
                    // - i nie ma już wpisanego (żeby nie nadpisywać ręcznej edycji)
                    const currentTitle = (legalRepresentativeTitle || '').trim();
                    if (pickedTitle && currentTitle.length === 0) {
                      onEditedDataChange('legal_representative_title', pickedTitle);
                    }
                  }}
                  disabled={availableContacts.length === 0}
                  className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">
                    {availableContacts.length === 0
                      ? '-- Brak osób kontaktowych (dodaj w zakładce Kontakty) --'
                      : '-- Wybierz osobę --'}
                  </option>
                  {availableContacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                    </option>
                  ))}
                </select>

                {selectedLegalRep ? (
                  <div className="text-sm text-gray-300">
                    <div className="font-medium">{selectedLegalRep.full_name}</div>
                    {selectedLegalRep.email && (
                      <div className="text-gray-400">{selectedLegalRep.email}</div>
                    )}
                    {selectedLegalRep.phone && (
                      <div className="text-gray-400">{selectedLegalRep.phone}</div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">Nie wybrano</div>
                )}

                <input
                  type="text"
                  value={legalRepresentativeTitle || ''}
                  onChange={(e) => onEditedDataChange('legal_representative_title', e.target.value)}
                  placeholder="Stanowisko (np. Prezes Zarządu)"
                  disabled={!legalRepresentative && availableContacts.length === 0}
                  className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
                />
                {availableContacts.length === 0 && (
                  <div className="text-xs text-amber-400">
                    💡 Najpierw dodaj osoby kontaktowe w zakładce &quot;Kontakty&quot; poniżej
                  </div>
                )}
              </div>
            ) : displayLegalRepresentative ? (
              <div className="text-sm text-gray-300">
                <div className="font-medium">{displayLegalRepresentative.full_name}</div>
                {legalRepresentativeTitle && (
                  <div className="text-amber-400">{legalRepresentativeTitle}</div>
                )}
                {displayLegalRepresentative.email && (
                  <div className="text-gray-400">{displayLegalRepresentative.email}</div>
                )}
              </div>
            ) : (
              <div className="text-sm text-gray-500">Nie wybrano</div>
            )}
          </>
        )}

        {contactIsRepresentative && primaryContact && (
          <div className="rounded bg-amber-500/10 p-3 text-sm text-amber-300">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4" />
              <span>Osoba kontaktowa: {primaryContact.full_name}</span>
            </div>
            {editMode && (
              <input
                type="text"
                value={legalRepresentativeTitle || ''}
                onChange={(e) => onEditedDataChange('legal_representative_title', e.target.value)}
                placeholder="Stanowisko (np. Prezes Zarządu)"
                className="mt-2 w-full rounded border border-amber-600/30 bg-amber-900/20 px-3 py-1.5 text-white placeholder-amber-400/50"
              />
            )}
            {!editMode && legalRepresentativeTitle && (
              <div className="mt-1 text-amber-400">{legalRepresentativeTitle}</div>
            )}
          </div>
        )}

        <div className="mt-5 border-t border-gray-700 pt-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-white">Sposób reprezentacji</h4>
              <p className="mt-1 text-xs leading-5 text-gray-400">
                {representationHelp}
              </p>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {registryProfile === 'krs' && (
                <a
                  href="https://www.gov.pl/web/gov/uzyskaj-informacje-z-krajowego-rejestru-sadowego"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[#d3bb73] hover:underline"
                >
                  Sprawdź KRS
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {registryProfile === 'ceidg' && (
                <a
                  href="https://aplikacja.ceidg.gov.pl/ceidg/ceidg.public.ui/search.aspx"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[#d3bb73] hover:underline"
                >
                  Sprawdź CEIDG
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>

          {editMode ? (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-gray-400">Typ reprezentacji</label>
                <select
                  value={representationType || ''}
                  onChange={(event) =>
                    onEditedDataChange('representation_type', event.target.value || null)
                  }
                  className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-white"
                >
                  <option value="">-- Wybierz po sprawdzeniu podstawy umocowania --</option>
                  {Object.entries(REPRESENTATION_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">
                  Dokładna zasada reprezentacji
                </label>
                <textarea
                  value={representationRule || ''}
                  onChange={(event) =>
                    onEditedDataChange('representation_rule', event.target.value)
                  }
                  rows={3}
                  placeholder={
                    registryProfile === 'krs'
                      ? 'np. Do składania oświadczeń wymagane jest współdziałanie dwóch członków zarządu.'
                      : 'np. Dyrektor działa samodzielnie na podstawie statutu albo właściciel ujawniony w CEIDG.'
                  }
                  className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-white placeholder-gray-500"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Podstawa weryfikacji</label>
                  <input
                    type="text"
                    value={representationBasis || ''}
                    onChange={(event) =>
                      onEditedDataChange('representation_basis', event.target.value)
                    }
                    placeholder={
                      registryProfile === 'krs'
                        ? 'KRS, Dział 2'
                        : registryProfile === 'ceidg'
                          ? 'CEIDG / pełnomocnictwo'
                          : 'Statut / uchwała / pełnomocnictwo'
                    }
                    className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-white placeholder-gray-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Data sprawdzenia</label>
                  <input
                    type="date"
                    value={representationVerifiedAt || ''}
                    onChange={(event) =>
                      onEditedDataChange('representation_verified_at', event.target.value || null)
                    }
                    className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-white"
                  />
                </div>
              </div>
            </div>
          ) : representationType || representationRule ? (
            <div className="space-y-2 text-sm text-gray-300">
              <div>
                <span className="text-gray-500">Typ: </span>
                {representationType ? REPRESENTATION_TYPE_LABELS[representationType] : '—'}
              </div>
              <div>
                <span className="text-gray-500">Zasada: </span>
                {representationRule || '—'}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-400">
                <span>Podstawa: {representationBasis || '—'}</span>
                <span>
                  Sprawdzono:{' '}
                  {representationVerifiedAt
                    ? new Date(`${representationVerifiedAt}T00:00:00`).toLocaleDateString('pl-PL')
                    : '—'}
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-300">
              Nie zweryfikowano sposobu reprezentacji.
            </div>
          )}

          {needsJointSigners && signerCount < 2 && (
            <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              Reprezentacja łączna wymaga wskazania co najmniej dwóch osób uprawnionych do
              podpisu. Dodaj je poniżej i zaznacz „Uprawniony do podpisu / współreprezentacji”.
            </div>
          )}
        </div>
      </div>

      {/* Osoby decyzyjne */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/30 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCircle className="h-5 w-5 text-green-400" />
            <h3 className="font-semibold text-white">
              Osoby decyzyjne i dodatkowi reprezentanci
            </h3>
          </div>
          {editMode && (
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1 rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700"
            >
              <Plus className="h-4 w-4" />
              Dodaj
            </button>
          )}
        </div>

        {decisionMakers.length > 0 ? (
          <div className="space-y-2">
            {decisionMakers.map((dm) => (
              <div
                key={dm.id}
                className="flex items-center justify-between rounded border border-gray-700 bg-gray-800/50 p-3"
              >
                <div className="text-sm">
                  <div className="font-medium text-white">
                    {dm.contact?.full_name || 'Nieznany kontakt'}
                  </div>
                  {dm.title && <div className="text-green-400">{dm.title}</div>}
                  {editMode ? (
                    <label className="mt-2 flex items-center gap-2 text-xs text-green-300">
                      <input
                        type="checkbox"
                        checked={dm.can_sign_contracts}
                        onChange={(event) =>
                          void handleSignerPermissionChange(dm, event.target.checked)
                        }
                        className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-800"
                      />
                      Uprawniony do podpisu / współreprezentacji
                    </label>
                  ) : dm.can_sign_contracts ? (
                    <div className="mt-1 inline-block rounded bg-green-900/30 px-2 py-0.5 text-xs text-green-300">
                      Uprawniony do podpisu / współreprezentacji
                    </div>
                  ) : null}
                </div>
                {editMode && (
                  <button
                    type="button"
                    onClick={() => handleRemoveDecisionMaker(dm.id)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500">Brak osób decyzyjnych</div>
        )}
      </div>

      {/* Modal dodawania osoby decyzyjnej */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 p-6">
            <h3 className="mb-4 text-lg font-semibold text-white">Dodaj osobę decyzyjną</h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-gray-300">Osoba</label>
                <select
                  value={newDM.contact_id}
                  onChange={(e) => setNewDM({ ...newDM, contact_id: e.target.value })}
                  disabled={availableDecisionMakerContacts.length === 0}
                  className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">
                    {availableDecisionMakerContacts.length === 0
                      ? availableContacts.length === 0
                        ? '-- Brak osób kontaktowych (dodaj w zakładce Kontakty) --'
                        : '-- Wszystkie osoby zostały już dodane --'
                      : '-- Wybierz --'}
                  </option>
                  {availableDecisionMakerContacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name} {c.position ? `(${c.position})` : ''}
                    </option>
                  ))}
                </select>
                {availableDecisionMakerContacts.length === 0 && (
                  <div className="mt-2 text-xs text-amber-400">
                    {availableContacts.length === 0
                      ? '💡 Najpierw dodaj osoby kontaktowe w zakładce „Kontakty” poniżej'
                      : 'Wszystkie dostępne osoby kontaktowe są już przypisane jako decyzyjne.'}
                  </div>
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-300">
                  Stanowisko/Rola (opcjonalne)
                </label>
                <input
                  type="text"
                  value={newDM.title}
                  onChange={(e) => setNewDM({ ...newDM, title: e.target.value })}
                  placeholder="np. Prokurent"
                  className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-white placeholder-gray-500"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={newDM.can_sign_contracts}
                  onChange={(e) => setNewDM({ ...newDM, can_sign_contracts: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-800"
                />
                <label className="text-sm text-gray-300">
                  Uprawniony do podpisu / współreprezentacji
                </label>
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={handleAddDecisionMaker}
                disabled={!newDM.contact_id}
                className="flex-1 rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
              >
                Dodaj
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(false);
                  setNewDM({ contact_id: '', title: '', can_sign_contracts: false });
                }}
                className="flex-1 rounded border border-gray-600 bg-gray-800 px-4 py-2 text-white hover:bg-gray-700"
              >
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
