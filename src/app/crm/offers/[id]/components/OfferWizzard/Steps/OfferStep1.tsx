'use client';

import { Package, Users, Plus } from 'lucide-react';

export interface OfferStep1Props {
  clientType: 'individual' | 'business' | '';
  setClientType: (v: 'individual' | 'business') => void;

  clientSearchQuery: string;
  setClientSearchQuery: (v: string) => void;

  organizations: any[];
  contacts: any[];

  selectedOrganizationId: string;
  setSelectedOrganizationId: (v: string) => void;

  selectedContactId: string;
  setSelectedContactId: (v: string) => void;

  setShowAddClientModal: (v: boolean) => void;
}

export function OfferStep1({
  clientType,
  setClientType,
  clientSearchQuery,
  setClientSearchQuery,
  organizations,
  contacts,
  selectedOrganizationId,
  setSelectedOrganizationId,
  selectedContactId,
  setSelectedContactId,
  setShowAddClientModal,
}: OfferStep1Props) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h3 className="mb-4 text-xl font-light text-[#e5e4e2]">Wybierz typ klienta</h3>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => setClientType('business')}
            className={`rounded-lg border-2 p-6 transition-all ${
              clientType === 'business'
                ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
            }`}
          >
            <Package className="mb-2 h-8 w-8 text-[#d3bb73]" />
            <h4 className="text-lg font-medium text-[#e5e4e2]">Klient biznesowy</h4>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">Organizacja / Firma</p>
          </button>
          <button
            onClick={() => setClientType('individual')}
            className={`rounded-lg border-2 p-6 transition-all ${
              clientType === 'individual'
                ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
            }`}
          >
            <Users className="mb-2 h-8 w-8 text-[#d3bb73]" />
            <h4 className="text-lg font-medium text-[#e5e4e2]">Klient indywidualny</h4>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">Osoba prywatna</p>
          </button>
        </div>
      </div>

      {clientType === 'business' && (
        <div>
          <h3 className="mb-4 text-xl font-light text-[#e5e4e2]">Wybierz organizację</h3>
          <div className="mb-4">
            <input
              type="text"
              placeholder="Szukaj organizacji..."
              value={clientSearchQuery}
              onChange={(e) => setClientSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {organizations
              .filter(
                (org) =>
                  org.name.toLowerCase().includes(clientSearchQuery.toLowerCase()) ||
                  org.nip?.toLowerCase().includes(clientSearchQuery.toLowerCase()),
              )
              .map((org) => (
                <button
                  key={org.id}
                  onClick={() => setSelectedOrganizationId(org.id)}
                  className={`w-full rounded-lg border p-4 text-left transition-all ${
                    selectedOrganizationId === org.id
                      ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                      : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                  }`}
                >
                  <h4 className="text-sm font-medium text-[#e5e4e2]">{org.name}</h4>
                  {org.nip && <p className="mt-1 text-xs text-[#e5e4e2]/60">NIP: {org.nip}</p>}
                  {org.email && <p className="text-xs text-[#e5e4e2]/60">{org.email}</p>}
                </button>
              ))}
          </div>
        </div>
      )}

      {clientType === 'individual' && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-xl font-light text-[#e5e4e2]">Wybierz kontakt</h3>
            <button
              onClick={() => setShowAddClientModal(true)}
              className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-4 py-2 text-[#d3bb73] transition-all hover:bg-[#d3bb73]/20"
            >
              <Plus className="h-4 w-4" />
              <span className="text-sm">Dodaj nowego klienta</span>
            </button>
          </div>
          <div className="mb-4">
            <input
              type="text"
              placeholder="Szukaj kontaktu..."
              value={clientSearchQuery}
              onChange={(e) => setClientSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {contacts
              .filter(
                (contact) =>
                  contact.full_name?.toLowerCase().includes(clientSearchQuery.toLowerCase()) ||
                  contact.email?.toLowerCase().includes(clientSearchQuery.toLowerCase()),
              )
              .map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => setSelectedContactId(contact.id)}
                  className={`w-full rounded-lg border p-4 text-left transition-all ${
                    selectedContactId === contact.id
                      ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                      : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                  }`}
                >
                  <h4 className="text-sm font-medium text-[#e5e4e2]">{contact.full_name}</h4>
                  {contact.email && <p className="mt-1 text-xs text-[#e5e4e2]/60">{contact.email}</p>}
                  {contact.phone && <p className="text-xs text-[#e5e4e2]/60">{contact.phone}</p>}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}