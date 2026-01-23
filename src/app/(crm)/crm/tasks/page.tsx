import { TasksPageClient } from './TaskPageClient';
import { cookies } from 'next/headers';
import { supabase } from '@/lib/supabase/browser';
import { fetchTasksServer } from '@/lib/CRM/tasks/tasksData.server';

export default async function TasksPage() {
  const initialTasks = await fetchTasksServer();
  return (
      <TasksPageClient initialTasks={initialTasks} />  
  );
}