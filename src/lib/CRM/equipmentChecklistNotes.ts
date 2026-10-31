export type ChecklistNote = { id: string; text: string; checked: boolean };
export function checklistNoteRecords(value: unknown, legacy?: string | null): ChecklistNote[] {
  if (Array.isArray(value)) return value.filter(n => n && typeof n.id === 'string' && typeof n.text === 'string')
    .map(n => ({ id: n.id, text: n.text, checked: n.checked === true }));
  return (legacy || '').split(/\r?\n/).filter(text => text.trim())
    .map((text, i) => ({ id: `legacy-${i}`, text, checked: false }));
}
