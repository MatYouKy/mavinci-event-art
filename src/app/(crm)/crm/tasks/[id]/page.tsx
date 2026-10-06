// app/(crm)/crm/tasks/[id]/page.tsx
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import TaskDetailClient from './TaskDetailClient';
import { getTaskByIdServer, Task } from '@/lib/CRM/tasks/getTaskById.server';
import { redirect } from 'next/navigation';

export default async function Page({ params }: { params: { id: string } }) {
  const initialTask = await getTaskByIdServer(params.id);
  // Preserve old bookmarks and notification links without opening the generic
  // task editor, whose status controls must not drive the sales pipeline.
  if (initialTask?.is_inquiry) redirect(`/crm/inquiries/${initialTask.id}`);
  return <TaskDetailClient initialTask={initialTask as unknown as Task} />;
}
