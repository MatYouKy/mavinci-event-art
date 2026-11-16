'use client';

import type { ReactNode } from 'react';
import {
  contractRequirementText,
  normalizeContractRequirement,
  type ContractRequirement,
  type ContractRequirementType,
} from '@/lib/CRM/contracts/contractRequirements';

/*
 * Parametry wymagania umowy (zasilanie, internet, miejsce, dojazd, montaż, zaplecze) — w klauzulach produktu i przy
 * porządkowaniu klauzul. Umowa łączy wymagania wszystkich usług w jeden zapis na typ (`mergeContractRequirements`).
 */

/** Wymaganie w trakcie edycji — pola mogą być chwilowo puste. */
export type ContractRequirementDraft = { type: ContractRequirementType } & Record<string, unknown>;

export const defaultContractRequirement = (type: ContractRequirementType): ContractRequirementDraft => {
  switch (type) {
    case 'power': return { type, phases: 1, current: 16 };
    case 'internet': return { type, connection: 'wifi' };
    case 'space': return { type, level: true };
    case 'access': return { type, vehicle: 'van' };
    case 'setup': return { type, before: 2, test: true };
    case 'backstage': return { type, room: true };
  }
};

/** Zdanie do umowy dla wpisanych parametrów (puste, gdy brak parametrów). */
export const contractRequirementDraftText = (draft: ContractRequirementDraft) => {
  const requirement = normalizeContractRequirement(draft);
  return requirement ? contractRequirementText(requirement) : '';
};

export const contractRequirementFromDraft = (draft: ContractRequirementDraft): ContractRequirement | null =>
  normalizeContractRequirement(draft);

const inputClass = 'mt-1 w-full rounded-lg border border-[#d3bb73]/25 bg-[#210811] px-3 py-2 text-sm text-[#e5e4e2] disabled:opacity-60';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="text-xs text-[#e5e4e2]/60">{label}{children}</label>;
}

export function ContractRequirementFields({
  value,
  onChange,
  disabled = false,
}: {
  value: ContractRequirementDraft;
  onChange: (next: ContractRequirementDraft) => void;
  disabled?: boolean;
}) {
  const set = (patch: Record<string, unknown>) => onChange({ ...value, ...patch });
  const numberValue = (key: string) => (typeof value[key] === 'number' ? String(value[key]).replace('.', ',') : '');
  const numberInput = (key: string, label: string, suffix?: string) => (
    <Field label={suffix ? `${label} (${suffix})` : label}>
      <input
        inputMode="decimal"
        disabled={disabled}
        value={numberValue(key)}
        onChange={(event) => {
          const text = event.target.value.replace(',', '.').trim();
          const parsed = Number(text);
          set({ [key]: text === '' || !Number.isFinite(parsed) ? undefined : parsed });
        }}
        className={inputClass}
      />
    </Field>
  );
  const check = (key: string, label: string) => (
    <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/80">
      <input type="checkbox" disabled={disabled} checked={value[key] === true} onChange={(event) => set({ [key]: event.target.checked || undefined })} />
      {label}
    </label>
  );

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {value.type === 'power' && <>
        <Field label="Przyłącze">
          <select disabled={disabled} value={String(value.phases ?? 1)} onChange={(event) => set({ phases: Number(event.target.value) })} className={inputClass}>
            <option value="1">230 V — jednofazowe</option>
            <option value="3">400 V — trójfazowe</option>
          </select>
        </Field>
        {numberInput('current', 'Zabezpieczenie', 'A')}
        {numberInput('sockets', 'Najmniej gniazd przy stanowisku')}
        {numberInput('distance', 'Najdalej od stanowiska', 'm')}
        <div className="md:col-span-2">{check('dedicated', 'Osobny obwód — niewspółdzielony z innymi urządzeniami')}</div>
      </>}
      {value.type === 'internet' && <>
        <Field label="Łącze">
          <select disabled={disabled} value={String(value.connection ?? 'wifi')} onChange={(event) => set({ connection: event.target.value })} className={inputClass}>
            <option value="wifi">Bezprzewodowe (Wi-Fi)</option>
            <option value="cable">Przewodowe (Ethernet)</option>
          </select>
        </Field>
        <div />
        {numberInput('download', 'Pobieranie co najmniej', 'Mb/s')}
        {numberInput('upload', 'Wysyłanie co najmniej', 'Mb/s')}
        <div className="md:col-span-2">{check('dedicated', 'Niewspółdzielone z uczestnikami wydarzenia')}</div>
      </>}
      {value.type === 'space' && <>
        {numberInput('width', 'Szerokość stanowiska', 'm')}
        {numberInput('depth', 'Głębokość stanowiska', 'm')}
        {numberInput('height', 'Wysokość w świetle', 'm')}
        <div />
        <div className="flex flex-wrap gap-4 md:col-span-2">
          {check('level', 'Równe i stabilne podłoże')}
          {check('dry', 'Suche miejsce')}
          {check('covered', 'Zadaszenie / osłona od opadów')}
        </div>
      </>}
      {value.type === 'access' && <>
        <Field label="Pojazd">
          <select disabled={disabled} value={String(value.vehicle ?? '')} onChange={(event) => set({ vehicle: event.target.value || undefined })} className={inputClass}>
            <option value="">Bez wskazania</option>
            <option value="car">Samochód osobowy</option>
            <option value="van">Samochód dostawczy (do 3,5 t)</option>
            <option value="truck">Samochód ciężarowy</option>
          </select>
        </Field>
        {numberInput('unloadDistance', 'Rozładunek najdalej od miejsca realizacji', 'm')}
        {numberInput('parking', 'Miejsca parkingowe dla ekipy')}
        <div className="flex items-end pb-2">{check('lift', 'Wniesienie bez schodów lub windą towarową')}</div>
      </>}
      {value.type === 'setup' && <>
        {numberInput('before', 'Dostęp przed wydarzeniem', 'godz.')}
        {numberInput('after', 'Demontaż po wydarzeniu', 'godz.')}
        <div className="flex flex-wrap gap-4 md:col-span-2">
          {check('test', 'Próba techniczna przed wydarzeniem')}
          {check('teardown', 'Demontaż po wydarzeniu')}
        </div>
      </>}
      {value.type === 'backstage' && <>
        {numberInput('people', 'Osoby obsługi')}
        <div />
        <div className="flex flex-wrap gap-4 md:col-span-2">
          {check('room', 'Zamykane zaplecze (garderoba)')}
          {check('water', 'Woda pitna')}
          {check('meal', 'Posiłek dla obsługi')}
        </div>
      </>}
    </div>
  );
}
