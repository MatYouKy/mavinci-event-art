import { ImageMetadata } from '@/lib/supabase/types';

export interface IEmployee {
  position: any;
  permissions: any;
  id: string;
  name: string;
  surname: string;
  nickname: string | null;
  email: string;
  personal_email: string | null;
  notification_email_preference: 'work' | 'personal' | 'both' | 'none';
  phone_number: string | null;
  phone_private: string | null;
  avatar_url: string | null;
  avatar_metadata: ImageMetadata | null;
  background_image_url: string | null;
  background_metadata: ImageMetadata | null;
  role: string;
  access_level: string;
  access_level_id: string | null;
  occupation: string | null;
  region: string | null;
  address_street: string | null;
  address_city: string | null;
  address_postal_code: string | null;
  nip: string | null;
  company_name: string | null;
  skills: string[] | null;
  qualifications: string[] | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  last_active_at: string | null;
  show_on_website: boolean;
  website_bio: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  order_index: number;
}

export type EmployeeCreateDTO = Omit<IEmployee, "id" | "created_at">;

// Update: patch po id
export type EmployeeUpdateDTO = Partial<Omit<IEmployee, "id" | "created_at">>;