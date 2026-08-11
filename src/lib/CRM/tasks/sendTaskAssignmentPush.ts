import { supabase } from '@/lib/supabase/browser';

export async function sendTaskAssignmentPush(assignmentIds: string | string[]) {
  const ids = Array.isArray(assignmentIds) ? assignmentIds : [assignmentIds];

  await Promise.allSettled(
    ids.filter(Boolean).map(async (assignmentId) => {
      const { error } = await supabase.functions.invoke('send-task-assignment-push', {
        body: { assignment_id: assignmentId },
      });

      if (error) {
        console.error('Task assignment push failed:', error);
      }
    }),
  );
}
