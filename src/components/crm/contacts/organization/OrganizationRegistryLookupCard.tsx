'use client';

import { Building2, CheckCircle2, Database, ShieldCheck, Users } from 'lucide-react';
import type { GUSCompanyData } from '@/lib/gus';

const sourceLabels: Record<string, string> = {
  gus: 'GUS / REGON',
  mf_whitelist: 'Biała lista VAT',
  krs: 'Krajowy Rejestr Sądowy',
  ceidg: 'CEIDG',
};

const businessTypeLabels: Record<string, string> = {
  company: 'Firma / organizacja',
  hotel: 'Hotel',
  restaurant: 'Restauracja / catering',
  venue: 'Obiekt / sala eventowa',
  freelancer: 'Freelancer',
  other: 'Inny',
};

const Info = ({ label, value }: { label: string; value?: string | number | null }) => {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-0.5 break-words text-sm text-white">{value}</div>
    </div>
  );
};

export default function OrganizationRegistryLookupCard({
  data,
}: {
  data: GUSCompanyData | null;
}) {
  if (!data) return null;

  const address = data.workingAddress || data.residenceAddress || [data.address, data.postalCode, data.city].filter(Boolean).join(', ');
  const sources = (data.dataSources?.length ? data.dataSources : [data.source]).filter(
    (source): source is string => Boolean(source),
  );
  const genericPeople = [
    ...(data.registryRoles?.length ? [] : data.representatives || []),
    ...(data.partners || []),
  ];

  return (
    <div className="md:col-span-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-emerald-500/15 p-2 text-emerald-300">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 font-medium text-white">
              Dane rejestrowe pobrane
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {sources.map((source) => (
                <span key={source} className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-gray-300">
                  {sourceLabels[source] || source}
                </span>
              ))}
            </div>
          </div>
        </div>
        {data.legalFormSource === 'inference' && (
          <span className="max-w-sm text-right text-xs leading-5 text-amber-300">
            Forma podmiotu została rozpoznana automatycznie. Sprawdź ją przed zapisaniem.
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Info label="Pełna nazwa" value={data.name} />
        <Info label="Forma prawna / typ podmiotu" value={data.legalFormName} />
        <Info
          label="Profil działalności"
          value={data.businessType ? businessTypeLabels[data.businessType] || data.businessType : ''}
        />
        <Info label="NIP" value={data.nip} />
        <Info label="REGON" value={data.regon} />
        <Info label="KRS" value={data.krs} />
        <Info label="Rejestr" value={data.registryName} />
        <Info label="Status VAT" value={data.vatStatus} />
        <Info label="Data rejestracji" value={data.registrationDate} />
        <Info label="Adres rejestrowy" value={address} />
        <Info label="Kraj" value={data.country} />
        <Info label="Województwo" value={data.voivodeship} />
        <Info label="Email" value={data.email} />
        <Info label="Telefon" value={data.phone} />
        <Info label="Strona WWW" value={data.website} />
        <Info label="Rachunki na białej liście" value={data.bankAccountCount} />
      </div>

      {data.representationRule && (
        <div className="mt-3 rounded-lg border border-blue-400/15 bg-blue-400/5 p-3">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-blue-300">
            <Building2 className="h-4 w-4" />
            Sposób reprezentacji
          </div>
          <p className="text-sm leading-6 text-gray-200">{data.representationRule}</p>
        </div>
      )}

      {genericPeople.length ? (
        <div className="mt-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[#d3bb73]">
            <Users className="h-4 w-4" />
            Osoby ujawnione w rejestrach
          </div>
          <div className="space-y-1 text-sm text-gray-200">
            {genericPeople.map((person) => (
              <div key={`${person.fullName}-${person.title}`}>
                {person.fullName}{person.title ? ` — ${person.title}` : ''}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {data.registryRoles?.length ? (
        <div className="mt-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[#d3bb73]">
            <Users className="h-4 w-4" />
            Zarząd i prokura ujawnione w KRS
          </div>
          <div className="space-y-2 text-sm text-gray-200">
            {data.registryRoles.map((role, index) => (
              <div key={`${role.kind}-${role.title}-${index}`}>
                <span className="font-medium text-white">{role.title}</span>
                {role.authorization ? ` — ${role.authorization}` : ''}
                <div className="text-xs text-gray-500">
                  {role.fullName
                    ? role.fullName
                    : 'Nie udało się pobrać pełnego imienia i nazwiska — wybierz właściwy kontakt ręcznie.'}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
        <Database className="h-3.5 w-3.5" />
        Dostępne wartości zostały przeniesione do pól formularza.
      </div>
    </div>
  );
}
