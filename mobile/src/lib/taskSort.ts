export const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export interface SortableTask {
  id: string;
  priority: string | null;
  due_date: string | null;
  created_at?: string | null;
}

/**
 * Sorts tasks by urgency: most urgent first (urgent > high > medium > low),
 * then by soonest due date, then by most recently created.
 */
export function sortTasksByUrgency<T extends SortableTask>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const pA = PRIORITY_ORDER[a.priority ?? ''] ?? 4;
    const pB = PRIORITY_ORDER[b.priority ?? ''] ?? 4;
    if (pA !== pB) return pA - pB;

    if (a.due_date && b.due_date) {
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    }
    if (a.due_date) return -1;
    if (b.due_date) return 1;

    const cA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const cB = b.created_at ? new Date(b.created_at).getTime() : 0;
    return cB - cA;
  });
}

/**
 * Applies urgency sort, then overrides with a manual order when one exists
 * for the given key (the "inna właściwość" that governs top position).
 */
export function sortTasksWithManualOverride<T extends SortableTask>(
  tasks: T[],
  manualOrder?: string[],
): T[] {
  const sorted = sortTasksByUrgency(tasks);
  if (!manualOrder || manualOrder.length === 0) return sorted;

  const indexOf = (id: string) => {
    const i = manualOrder.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return sorted.sort((a, b) => indexOf(a.id) - indexOf(b.id));
}
