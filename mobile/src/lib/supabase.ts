import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export { supabaseUrl, supabaseAnonKey };

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Types shared with web application
export interface Employee {
  has_realizations?: boolean;
  id: string;
  name: string;
  surname: string;
  nickname?: string | null;
  email: string;
  phone?: string | null;
  role?: string;
  access_level?: string;
  permissions?: string[];
  avatar_url?: string | null;
  avatar_metadata?: any;
  team_page_metadata?: any;
  show_on_website?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Client {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  company_name?: string | null;
  nip?: string | null;
  address?: string | null;
  client_type: 'individual' | 'company';
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Event {
  id: string;
  name: string;
  description?: string | null;
  event_date: string;
  event_end_date?: string | null;
  location?: string | null;
  client_id?: string | null;
  organization_id?: string | null;
  contact_person_id?: string | null;
  billing_arrangement?: 'direct' | 'hotel' | 'agency' | 'other';
  billing_organization_id?: string | null;
  location_id?: string | null;
  status: string;
  category_id?: string | null;
  my_company_id?: string | null;
  budget?: number | null;
  final_cost?: number | null;
  expected_revenue?: number | null;
  actual_revenue?: number | null;
  estimated_costs?: number | null;
  actual_costs?: number | null;
  equipment_checklist_pdf_path?: string | null;
  loading_confirmed?: boolean;
  loading_confirmed_at?: string | null;
  loading_confirmed_by?: string | null;
  loading_notes?: string | null;
  loading_locked?: boolean;
  loading_unlock_requested?: boolean;
  loading_unlock_requested_at?: string | null;
  loading_unlock_requested_by?: string | null;
  loading_unlock_reason?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_date?: string | null;
  assigned_to?: string | null;
  created_by?: string | null;
  event_id?: string | null;
  is_private?: boolean;
  order_index?: number;
  created_at?: string;
  updated_at?: string;
}
