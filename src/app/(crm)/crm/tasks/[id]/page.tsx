// app/(crm)/crm/tasks/[id]/page.tsx
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import TaskDetailClient from './TaskDetailClient';
import { getTaskByIdServer, Task } from '@/lib/CRM/tasks/getTaskById.server';

export default async function Page({ params }: { params: { id: string } }) {
  const initialTask = await getTaskByIdServer(params.id);
  return <TaskDetailClient initialTask={initialTask as unknown as Task} />;
}