import { supabase } from '@/lib/supabase/browser';

// Read the saved preference at the moment of moving a card, so another open tab
// immediately respects settings saved by the administrator.
export async function shouldAutomateTaskTimer(employeeId: string | undefined, isAdmin: boolean): Promise<boolean> {
  if (!employeeId) throw new Error('Nie udało się ustalić zalogowanego pracownika.');
  if (!isAdmin) return true;
  const { data, error } = await supabase
    .from('employees')
    .select('preferences')
    .eq('id', employeeId)
    .single();
  if (error) throw error;
  return data?.preferences?.notifications?.autoStartTaskTimer !== false;
}
