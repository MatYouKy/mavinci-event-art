'use client';
import { supabase } from '@/lib/supabase/browser';
import type { CompensationSettings, EmployeeCompensation } from './compensation';
export async function loadCompensationSettings(): Promise<CompensationSettings> {
  const { data, error } = await supabase
    .from('compensation_settings')
    .select('*')
    .eq('id', 1)
    .single();
  if (error) throw error;
  return data;
}
export async function loadEmployeeCompensation(
  employeeId: string,
): Promise<EmployeeCompensation | null> {
  const { data, error } = await supabase
    .from('employee_compensation')
    .select('*')
    .eq('employee_id', employeeId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
