export function mergeEventTeam(assignments: any[], responsibilities: any[]) {
  const people = new Map<string, any>();
  for (const item of assignments) {
    const person = item.employee || item;
    const id = item.employee_id || person.id;
    if (!id || item.status === 'rejected') continue;
    people.set(id, {
      ...person,
      id,
      name: person.name || '',
      surname: person.surname || '',
      role: item.role || null,
      responsibilities: item.responsibilities,
      status: item.status,
      phone_number: person.phone_number || item.phone,
      email: person.email || item.email,
    });
  }
  for (const item of responsibilities) {
    const person = item.employee;
    if (!person?.id) continue;
    const existing = people.get(person.id);
    people.set(person.id, {
      ...person,
      ...existing,
      id: person.id,
      name: person.name || existing?.name || '',
      surname: person.surname || existing?.surname || '',
      phone_number: person.phone_number || existing?.phone_number,
      email: person.email || existing?.email,
      status: existing?.status || item.status,
      responsibility_roles: item.responsibility_roles || [],
    });
  }
  return [...people.values()];
}
