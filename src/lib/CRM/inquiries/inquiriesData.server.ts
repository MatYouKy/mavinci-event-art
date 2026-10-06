import 'server-only';

import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

export type InquiryDetails = {
  category?: string | null;
  subject?: string | null;
  source_message_type?: string | null;
  source_kind?: 'contact_form' | 'webhook' | string;
  source_name?: string | null;
  source_slug?: string | null;
  source_page?: string | null;
  event_type?: string | null;
  event_time?: string | null;
  source_message_date?: string | null;
  termin?: string | null;
  location_text?: string | null;
  scope?: string | null;
  event_assumptions?: string | null;
  event_goal?: string | null;
  budget?: string | number | null;
  client_text?: string | null;
  client_phone?: string | null;
  client_email?: string | null;
  client_company?: string | null;
  source_message_content?: string | null;
};

export type InquiryListItem = {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: string;
  board_column: string;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  inquiry_details: InquiryDetails | null;
  inquiry_stage: InquiryStage;
  inquiry_owner_id: string | null;
  next_action_at: string | null;
  last_contact_at: string | null;
  first_contact_at: string | null;
  sla_first_contact_due_at: string | null;
  estimated_value: number | null;
  win_probability: number;
  lost_reason: string | null;
  linked_offer_id: string | null;
  event_id: string | null;
  contact_id: string | null;
  organization_id: string | null;
  lost_reason_category: string | null;
  inquiry_owner: InquiryEmployee | null;
};

export type InquiryStage =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'proposal'
  | 'negotiation'
  | 'won'
  | 'lost';

export type InquiryEmployee = {
  id: string;
  name: string;
  surname: string;
  avatar_url: string | null;
  sales_team_id: string | null;
  is_sales_team_manager: boolean;
};

export async function fetchInquiriesServer(): Promise<InquiryListItem[]> {
  const supabase = createSupabaseServerClient(cookies());
  const { data, error } = await supabase
    .from('tasks')
    .select(
      `
        id, title, description, priority, status, board_column, due_date, created_at, updated_at,
        inquiry_details, inquiry_stage, inquiry_owner_id, next_action_at, last_contact_at,
        first_contact_at, sla_first_contact_due_at,
        estimated_value, win_probability, lost_reason, lost_reason_category,
        linked_offer_id, event_id, contact_id, organization_id,
        inquiry_owner:employees!tasks_inquiry_owner_id_fkey(id, name, surname, avatar_url, sales_team_id, is_sales_team_manager)
      `,
    )
    .eq('is_inquiry', true).is('archived_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as InquiryListItem[];
}

export async function fetchInquiryEmployeesServer(): Promise<InquiryEmployee[]> {
  const supabase = createSupabaseServerClient(cookies());
  const { data, error } = await supabase
    .from('employees')
    .select('id, name, surname, avatar_url, sales_team_id, is_sales_team_manager')
    .eq('is_active', true)
    .order('surname', { ascending: true });

  if (error) throw error;
  return (data ?? []) as InquiryEmployee[];
}
