import React, { useEffect, useMemo, useState } from 'react';
import { Text } from 'react-native';
import { Label, Segmented, SelectField, Sheet, SheetActions, kit } from '../Inquiries/InquiryKit';
import { DEPARTMENTS, department as normalizeDepartment, departmentLabel, type Department } from '../../lib/teamAvailability';
import { saveEmployeeStructure } from '../../lib/teamAvailabilityApi';
import { colors } from '../../theme';

/*
 * Pracownicy → „Dział i przełożony” (jak karta w CRM i na Macu, docs/team-availability.md): dział wyznacza zakres planu
 * w Spotkaniach → „Pracownicy”, przełożony — piramidę (widzi plan podwładnych). Zmienia administrator albo „Zarządzanie
 * pracownikami”; przełożonym nie może być ta osoba ani nikt z jej podwładnych (pilnuje też baza).
 */

export type StructurePerson = {
  id: string;
  name: string;
  surname: string;
  nickname?: string | null;
  department?: string | null;
  supervisor_id?: string | null;
};

const personName = (person: StructurePerson) => person.nickname?.trim() || `${person.name || ''} ${person.surname || ''}`.trim() || 'Pracownik';

export default function EmployeeStructureSheet({ target, people, onClose, onSaved }: {
  target: StructurePerson | null;
  people: StructurePerson[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<Department>('office');
  const [supervisor, setSupervisor] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setValue(normalizeDepartment(target.department));
    setSupervisor(target.supervisor_id ?? '');
    setError(null);
  }, [target]);

  // Ta osoba i cała jej gałąź podwładnych — nie mogą być przełożonym.
  const blocked = useMemo(() => {
    const result = new Set<string>(target ? [target.id] : []);
    let added = true;
    while (added) {
      added = false;
      people.forEach((person) => {
        if (person.supervisor_id && result.has(person.supervisor_id) && !result.has(person.id)) {
          result.add(person.id);
          added = true;
        }
      });
    }
    return result;
  }, [people, target]);

  const options = useMemo(() => [
    { id: '', label: 'Brak przełożonego' },
    ...people
      .filter((person) => !blocked.has(person.id))
      .sort((a, b) => personName(a).localeCompare(personName(b), 'pl'))
      .map((person) => ({ id: person.id, label: personName(person), detail: departmentLabel(person.department) })),
  ], [people, blocked]);

  const save = async () => {
    if (!target || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveEmployeeStructure(target.id, value, supervisor || null);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać działu.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={target !== null} title="Dział i przełożony" subtitle={target ? personName(target) : undefined} onClose={onClose}
      footer={<SheetActions onCancel={onClose} onConfirm={() => { void save(); }} label="Zapisz" saving={saving} />}>
      <Label>Dział</Label>
      <Segmented<Department> value={value} options={DEPARTMENTS.map((option) => ({ id: option.value, label: option.label }))} onChange={setValue} />
      <Text style={kit.muted}>{DEPARTMENTS.find((option) => option.value === value)?.hint}</Text>
      <Label>Przełożony</Label>
      <SelectField value={supervisor} options={options} onChange={setSupervisor} placeholder="Brak przełożonego" />
      <Text style={kit.muted}>Przełożony widzi plan (z tytułami spotkań) swoich podwładnych.</Text>
      {error ? <Text style={[kit.text, { color: colors.status.error }]}>{error}</Text> : null}
    </Sheet>
  );
}
