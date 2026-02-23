'use client';

import { useState } from 'react';
import { UserCircle, Plus, Trash2, Check, Shield } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

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
}

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
}: Props) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newDM, setNewDM] = useState({
    contact_id: '',
    title: '',
    can_sign_contracts: false,
  });

  const handleAddDecisionMaker = async () => {
    if (!newDM.contact_id) return;

    try {
      await supabase.from('organization_decision_makers').insert({
        organization_id: organizationId,
        contact_id: newDM.contact_id,
        title: newDM.title || null,
        can_sign_contracts: newDM.can_sign_contracts,
      });

      setShowAddModal(false);
      setNewDM({ contact_id: '', title: '', can_sign_contracts: false });
      onUpdate();
    } catch (error) {
      console.error('Error adding decision maker:', error);
    }
  };

  const handleRemoveDecisionMaker = async (id: string) => {
    if (!confirm('Usunąć osobę decyzyjną?')) return;

    try {
      await supabase.from('organization_decision_makers').delete().eq('id', id);
      onUpdate();
    } catch (error) {
      console.error('Error removing decision maker:', error);
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
          <select
            value={primaryContact?.id || ''}
            onChange={(e) => onEditedDataChange('primary_contact_id', e.target.value || null)}
            className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-white"
          >
            <option value="">-- Wybierz osobę --</option>
            {availableContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name} {c.position ? `(${c.position})` : ''}
              </option>
            ))}
          </select>
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
          <h3 className="font-semibold text-white">Reprezentant prawny</h3>
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
              Osoba kontaktowa jest też reprezentantem
            </label>
          </div>
        )}

        {!contactIsRepresentative && (
          <>
            {editMode ? (
              <div className="space-y-3">
                <select
                  value={legalRepresentative?.id || ''}
                  onChange={(e) =>
                    onEditedDataChange('legal_representative_id', e.target.value || null)
                  }
                  className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-white"
                >
                  <option value="">-- Wybierz osobę --</option>
                  {availableContacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={legalRepresentativeTitle || ''}
                  onChange={(e) => onEditedDataChange('legal_representative_title', e.target.value)}
                  placeholder="Stanowisko (np. Prezes Zarządu)"
                  className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-white placeholder-gray-500"
                />
              </div>
            ) : legalRepresentative ? (
              <div className="text-sm text-gray-300">
                <div className="font-medium">{legalRepresentative.full_name}</div>
                {legalRepresentativeTitle && (
                  <div className="text-amber-400">{legalRepresentativeTitle}</div>
                )}
                {legalRepresentative.email && (
                  <div className="text-gray-400">{legalRepresentative.email}</div>
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
      </div>

      {/* Osoby decyzyjne */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/30 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCircle className="h-5 w-5 text-green-400" />
            <h3 className="font-semibold text-white">Osoby decyzyjne</h3>
          </div>
          {editMode && (
            <button
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
                  {dm.can_sign_contracts && (
                    <div className="mt-1 inline-block rounded bg-green-900/30 px-2 py-0.5 text-xs text-green-300">
                      Może podpisywać umowy
                    </div>
                  )}
                </div>
                {editMode && (
                  <button
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
                  className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-white"
                >
                  <option value="">-- Wybierz --</option>
                  {availableContacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name} {c.position ? `(${c.position})` : ''}
                    </option>
                  ))}
                </select>
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
                <label className="text-sm text-gray-300">Może podpisywać umowy</label>
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <button
                onClick={handleAddDecisionMaker}
                disabled={!newDM.contact_id}
                className="flex-1 rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
              >
                Dodaj
              </button>
              <button
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
