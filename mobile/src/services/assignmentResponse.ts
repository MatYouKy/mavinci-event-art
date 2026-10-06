import { supabase } from '../lib/supabase';

// A single conditional write wins even when email and mobile respond together.
export async function respondToAssignment(id: string, status: 'accepted' | 'rejected') {
  const { data, error } = await supabase
    .from('employee_assignments')
    .update({ status, responded_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id,status,role,responded_at')
    .maybeSingle();
  if (error) throw error;
  if (data) return data;
  const current = await supabase
    .from('employee_assignments')
    .select('id,status,role,responded_at')
    .eq('id', id)
    .single();
  if (current.error) throw current.error;
  return current.data;
}
